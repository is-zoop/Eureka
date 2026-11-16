use std::{future::Future, time::Duration};
use tauri_plugin_updater::Error;

pub const MAX_ATTEMPTS: u8 = 3;
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
pub const READ_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug)]
pub struct Failure {
    pub code: &'static str,
    retryable: bool,
    pub detail: String,
}

fn status_failure(status: u16, detail: String) -> Failure {
    let (code, retryable) = match status {
        408 => ("TIMEOUT", true),
        // Avoid repeatedly hitting a rate-limited server. Let the user retry later.
        429 => ("RATE_LIMITED", false),
        500..=599 => ("SERVER", true),
        404 => ("MISSING", false),
        _ => ("SERVER", false),
    };
    Failure {
        code,
        retryable,
        detail,
    }
}

pub fn classify(error: Error) -> Failure {
    match error {
        Error::Reqwest(error) => {
            if let Some(status) = error.status() {
                return status_failure(status.as_u16(), format!("HTTP {status}"));
            }
            let timeout = error.is_timeout();
            let decode = error.is_decode();
            let transport = error.is_connect() || error.is_request() || error.is_body();
            let mut invalid_json = false;
            let mut causes = Vec::new();
            let mut source = std::error::Error::source(&error);
            while let Some(cause) = source {
                invalid_json |= cause.is::<serde_json::Error>();
                causes.push(cause.to_string());
                source = cause.source();
            }
            // Do not log request URLs: redirected asset URLs may contain credentials.
            let detail = format!("{}; {}", error.without_url(), causes.join("; "));
            let lower = detail.to_ascii_lowercase();
            let tls = ["certificate", "invalid peer", "tls", "ssl"]
                .iter()
                .any(|word| lower.contains(word));
            let (code, retryable) = if tls {
                ("TLS", false)
            } else if timeout {
                ("TIMEOUT", true)
            } else if invalid_json {
                ("MANIFEST", false)
            } else if transport || decode {
                // reqwest also wraps truncated response bodies in Decode errors.
                // Only an actual JSON parser error is a permanent manifest error.
                ("NETWORK", true)
            } else {
                ("UNKNOWN", false)
            };
            Failure {
                code,
                retryable,
                detail,
            }
        }
        Error::Network(detail) => {
            let status = detail
                .rsplit_once("status: ")
                .and_then(|(_, value)| value.split_whitespace().next())
                .and_then(|value| value.parse::<u16>().ok());
            status
                .map(|status| status_failure(status, detail.clone()))
                .unwrap_or(Failure {
                    code: "NETWORK",
                    retryable: false,
                    detail,
                })
        }
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => Failure {
            code: "SIGNATURE",
            retryable: false,
            detail: "Signature verification failed".into(),
        },
        Error::ReleaseNotFound
        | Error::Serialization(_)
        | Error::Semver(_)
        | Error::TargetNotFound(_)
        | Error::TargetsNotFound(_) => Failure {
            code: "MANIFEST",
            retryable: false,
            detail: error.to_string(),
        },
        Error::Io(_) => Failure {
            code: "STORAGE",
            retryable: false,
            detail: error.to_string(),
        },
        _ => Failure {
            code: "UNKNOWN",
            retryable: false,
            detail: error.to_string(),
        },
    }
}

// Keep a single retry budget for the entire operation, including interrupted bodies.
// The callback publishes retry progress and writes diagnostics before the async delay.
pub async fn retry<T, F, Fut, R, S, Sleep>(
    mut operation: F,
    mut failed: R,
    mut sleep: S,
) -> Result<T, Failure>
where
    F: FnMut(u8) -> Fut,
    Fut: Future<Output = Result<T, Error>>,
    R: FnMut(u8, &Failure, bool),
    S: FnMut(Duration) -> Sleep,
    Sleep: Future<Output = ()>,
{
    for attempt in 1..=MAX_ATTEMPTS {
        match operation(attempt).await {
            Ok(value) => return Ok(value),
            Err(error) => {
                let failure = classify(error);
                let again = failure.retryable && attempt < MAX_ATTEMPTS;
                failed(attempt, &failure, again);
                if !again {
                    return Err(failure);
                }
                sleep(Duration::from_secs(1 << (attempt - 1))).await;
            }
        }
    }
    unreachable!("retry budget is nonzero")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::VecDeque};

    fn client() -> reqwest::ClientBuilder {
        // Match the updater plugin's production TLS initialization.
        let _ = rustls::crypto::ring::default_provider().install_default();
        reqwest::Client::builder().no_proxy()
    }

    fn http(status: u16) -> Error {
        Error::Network(format!("Download request failed with status: {status}"))
    }

    #[test]
    fn retry_budget_and_backoff_are_bounded() {
        tauri::async_runtime::block_on(async {
            let mut attempts = 0;
            let delays = RefCell::new(Vec::new());
            let failures = RefCell::new(Vec::new());
            let result = retry::<(), _, _, _, _, _>(
                |_| {
                    attempts += 1;
                    std::future::ready(Err(http(503)))
                },
                |attempt, failure, again| {
                    failures.borrow_mut().push((attempt, failure.code, again))
                },
                |delay| {
                    delays.borrow_mut().push(delay.as_secs());
                    std::future::ready(())
                },
            )
            .await;
            assert_eq!(attempts, 3);
            assert_eq!(*delays.borrow(), [1, 2]);
            assert_eq!(failures.borrow().last(), Some(&(3, "SERVER", false)));
            assert_eq!(result.unwrap_err().code, "SERVER");
        });
    }

    #[test]
    fn transient_failure_can_recover_without_another_operation() {
        tauri::async_runtime::block_on(async {
            let mut results = VecDeque::from([Err(http(502)), Ok("verified bytes")]);
            let result = retry(
                |_| std::future::ready(results.pop_front().unwrap()),
                |_, _, _| {},
                |_| std::future::ready(()),
            )
            .await;
            assert_eq!(result.unwrap(), "verified bytes");
            assert!(results.is_empty());
        });
    }

    #[test]
    fn permanent_failures_are_not_retried() {
        tauri::async_runtime::block_on(async {
            for error in [
                http(404),
                http(429),
                Error::ReleaseNotFound,
                Error::SignatureUtf8("bad signature".into()),
            ] {
                let mut error = Some(error);
                let result = retry::<(), _, _, _, _, _>(
                    |_| std::future::ready(Err(error.take().expect("must not retry"))),
                    |_, _, again| assert!(!again),
                    |_| async { panic!("must not delay") },
                )
                .await;
                assert!(result.is_err());
            }
        });
    }

    #[test]
    fn connection_failures_are_classified_and_retryable() {
        tauri::async_runtime::block_on(async {
            // Only contact a loopback port that has just been closed.
            let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = socket.local_addr().unwrap();
            drop(socket);
            let error = client()
                .build()
                .unwrap()
                .get(format!("http://{address}/private?token=secret"))
                .send()
                .await
                .unwrap_err();
            let failure = classify(error.into());
            assert_eq!(failure.code, "NETWORK");
            assert!(failure.retryable);
            assert!(!failure.detail.contains("token=secret"));
        });
    }

    #[test]
    fn a_stalled_response_is_a_retryable_timeout() {
        tauri::async_runtime::block_on(async {
            let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            // TCP connects, but this listener never sends HTTP headers.
            let error = client()
                .timeout(Duration::from_millis(40))
                .build()
                .unwrap()
                .get(format!("http://{}/", socket.local_addr().unwrap()))
                .send()
                .await
                .unwrap_err();
            let failure = classify(error.into());
            assert_eq!(failure.code, "TIMEOUT");
            assert!(failure.retryable);
        });
    }

    #[test]
    fn an_interrupted_body_is_retryable_but_invalid_json_is_not() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            thread,
        };
        tauri::async_runtime::block_on(async {
            for (response, code, retryable) in [
                (
                    "HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\nshort",
                    "NETWORK",
                    true,
                ),
                (
                    "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nnope",
                    "MANIFEST",
                    false,
                ),
            ] {
                let listener = TcpListener::bind("127.0.0.1:0").unwrap();
                let address = listener.local_addr().unwrap();
                let server = thread::spawn(move || {
                    let (mut stream, _) = listener.accept().unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    let mut request = [0; 2048];
                    let _ = stream.read(&mut request);
                    stream.write_all(response.as_bytes()).unwrap();
                });
                let error = client()
                    .timeout(Duration::from_secs(2))
                    .build()
                    .unwrap()
                    .get(format!("http://{address}/"))
                    .send()
                    .await
                    .unwrap()
                    .json::<serde_json::Value>()
                    .await
                    .unwrap_err();
                let failure = classify(error.into());
                assert_eq!(failure.code, code);
                assert_eq!(failure.retryable, retryable);
                server.join().unwrap();
            }
        });
    }
}
