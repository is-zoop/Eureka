fn main() {
    let source = "../../features/automation/sdk/automation-sdk-contract.json";
    println!("cargo:rerun-if-changed={source}");
    let contract: serde_json::Value = serde_json::from_slice(&std::fs::read(source).expect("read SDK contract")).expect("parse SDK contract");
    let response = contract["limits"]["httpResponseBytes"].as_u64().expect("HTTP limit");
    let legacy = contract["limits"]["legacyDownloadBytes"].as_u64().expect("legacy download limit");
    std::fs::write(std::path::Path::new(&std::env::var("OUT_DIR").expect("OUT_DIR")).join("automation-sdk-limits.rs"), format!("const MAX_RESPONSE_BYTES: usize = {response};\nconst MAX_DOWNLOAD_BYTES: usize = {legacy};\n")).expect("generate SDK limits");
    println!("cargo:rerun-if-changed=app.manifest");
    let attributes = tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new().app_manifest(include_str!("app.manifest")),
    );
    tauri_build::try_build(attributes).expect("failed to prepare Eureka desktop resources");
}
