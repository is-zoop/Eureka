"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, GitBranchIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { ContextMenu } from "@base-ui/react/context-menu";
import { useI18n } from "@/hooks/useI18n";
import { notify } from "@/lib/notification-store";
import { NotificationNotice } from "./Notifications";
import { getFileName } from "@/lib/file-paths";
import type { GitDiffMode, GitMutation, GitWorkspace, GitWorkspaceFile } from "@/lib/git-types";
import styles from "./GitPanel.module.css";
import { getFileIcon } from "./FileIcons";
import { FileListSkeleton } from "./FileListSkeleton";
import { Collapse } from "./Collapse";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "./ui/dropdown-menu";

interface Props {
  cwd: string;
  refreshKey: number;
  onChanged: () => void;
  onOpenFile?: (filePath: string, name: string, options: { modeHint: "diff"; gitDiffMode: GitDiffMode }) => void;
}

export function GitPanel({ cwd, refreshKey, onChanged, onOpenFile }: Props) {
  const { t, locale } = useI18n();
  const [workspace, setWorkspace] = useState<GitWorkspace | null>(null);
  const [message, setMessage] = useState("");
  const [remote, setRemote] = useState("");
  const [busy, setBusy] = useState<GitMutation["action"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMode, setCommitMode] = useState<"commit" | "commitPush">("commit");
  const [showHistory, setShowHistory] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({ staged: false, unstaged: false });
  const groupId = useId();
  const [discard, setDiscard] = useState<{ file: GitWorkspaceFile; revision: string } | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const cancelDiscardRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  const draftKey = `eureka:git-message:${cwd}`;

  const errorText = useCallback((body: { code?: string; error?: string }) => {
    const key = `git.error.${body.code}`;
    const translated = t(key);
    return translated === key ? body.error || t("git.failed") : translated;
  }, [t]);

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const response = await fetch(`/api/git/workspace?${new URLSearchParams({ cwd })}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(errorText(body));
      if (mountedRef.current && request === requestRef.current) {
        setWorkspace(body);
        setLoadError(null);
        setRemote((current) => body.remote || (body.remotes.includes(current) ? current
          : body.remotes.includes("origin") ? "origin" : body.remotes[0] || ""));
      }
    } catch (failure) {
      if (mountedRef.current && request === requestRef.current) {
        setLoadError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (mountedRef.current && request === requestRef.current) setLoading(false);
    }
  }, [cwd, errorText]);

  useEffect(() => {
    mountedRef.current = true;
    setShowHistory(false);
    try { setMessage(localStorage.getItem(draftKey) || ""); } catch { /* Storage is optional. */ }
    return () => { mountedRef.current = false; };
  }, [draftKey]);

  useEffect(() => {
    const load = () => {
      if (!busyRef.current && document.visibilityState === "visible") void refresh();
    };
    load();
    const timer = setInterval(load, 5000);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [refresh, refreshKey]);

  const saveMessage = (value: string) => {
    setMessage(value);
    try {
      if (value) localStorage.setItem(draftKey, value);
      else localStorage.removeItem(draftKey);
    } catch { /* Storage is optional. */ }
  };

  const mutate = async (action: GitMutation["action"], paths?: string[], options?: { remote?: string; revision?: string; expectedContentHash?: string }) => {
    if (!workspace || busyRef.current) return;
    busyRef.current = true;
    requestRef.current++;
    setBusy(action);
    setError(null);
    const shouldPush = action === "commit" && commitMode === "commitPush";
    let committed = false;
    try {
      const send = async (command: GitMutation["action"], revision: string) => {
        const response = await fetch("/api/git/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, action: command, paths, revision, message, remote: options?.remote ?? remote,
            stageAllIfEmpty: command === "commit" ? true : undefined, expectedContentHash: options?.expectedContentHash }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(errorText(result));
        return result;
      };
      const body = await send(action, options?.revision ?? workspace.revision);
      if (action === "commit") {
        committed = true;
        // Also clear the saved draft if the user switched panels while Git was running.
        try { localStorage.removeItem(draftKey); } catch { /* Storage is optional. */ }
      }
      if (mountedRef.current) {
        if (action === "commit") {
          setMessage("");
          setCommitOpen(false);
        }
      }
      if (action === "commit" && !shouldPush) notify({ type: "success", message: `${t("git.committed")} · ${body.commit.slice(0, 7)}` });
      if (action === "push") notify({ type: "success", message: t("git.pushed") });
      onChanged();
      if (shouldPush) {
        if (mountedRef.current) setBusy("push");
        const response = await fetch(`/api/git/workspace?${new URLSearchParams({ cwd })}`, { cache: "no-store" });
        const latest = await response.json();
        if (!response.ok) throw new Error(errorText(latest));
        if (latest.head !== body.commit || latest.branch !== workspace.branch || latest.upstream !== workspace.upstream
          || latest.remote !== workspace.remote || latest.remoteBranch !== workspace.remoteBranch) {
          throw new Error(t("git.error.stale"));
        }
        await send("push", latest.revision);
        notify({ type: "success", message: `${t("git.committed")} · ${body.commit.slice(0, 7)} · ${t("git.pushed")}` });
      }
    } catch (failure) {
      if (mountedRef.current) {
        const detail = failure instanceof Error ? failure.message : String(failure);
        setError(committed && shouldPush ? `${t("git.pushFailedAfterCommit")}\n${detail}` : detail);
      }
    } finally {
      if (mountedRef.current) {
        await refresh();
        setBusy(null);
        if (action === "discard") setDiscard(null);
      }
      busyRef.current = false;
    }
  };

  const staged = workspace?.files.filter((file) => file.indexStatus !== " " && file.indexStatus !== "?") ?? [];
  const unstaged = workspace?.files.filter((file) => file.worktreeStatus !== " ") ?? [];
  const blocked = !!loadError || !workspace?.branch || workspace.operationInProgress || workspace.files.some((file) => file.status === "conflict");
  const commitCount = staged.length || workspace?.files.length || 0;
  const canCommit = !blocked && commitCount > 0;
  const openCommit = (mode: "commit" | "commitPush", targetRemote?: string) => {
    if (targetRemote) setRemote(targetRemote);
    setCommitMode(mode);
    setError(null);
    setCommitOpen(true);
  };

  const renderGroup = (files: GitWorkspaceFile[], selected: boolean) => {
    if (selected && !files.length) return null;
    const group = selected ? "staged" : "unstaged";
    const open = !collapsedGroups[group];
    const contentId = `${groupId}-${group}`;
    return <div className={styles.group}>
      <div className={styles.groupHeader}>
        <button type="button" className={styles.groupToggle} aria-expanded={open} aria-controls={contentId}
          onClick={() => setCollapsedGroups((current) => ({ ...current, [group]: !current[group] }))}>
          <ChevronDownIcon size={14} className={styles.groupChevron} data-open={open} />
          <span>{t(selected ? "git.selected" : "git.other")}</span>
          <span className={styles.groupCount}>{files.length}</span>
        </button>
        {files.length > 0 && <button type="button" className={styles.groupAction} disabled={!!busy || !!loadError || files.some((file) => !file.canStage)}
          onClick={() => void mutate(selected ? "unstage" : "stage", files.map((file) => file.relativePath))}>
          {t(selected ? "git.unstageAll" : "git.stageAll")}
        </button>}
      </div>
      <div id={contentId}>
      <Collapse open={open}>
      {files.map((file) => <ContextMenu.Root key={file.relativePath}>
        <Tooltip>
        <ContextMenu.Trigger render={<TooltipTrigger render={<button type="button" className={styles.fileRow} aria-label={file.relativePath} disabled={!!busy}
          onClick={() => {
            onOpenFile?.(file.filePath, getFileName(file.filePath), {
              modeHint: "diff", gitDiffMode: selected ? "staged" : "unstaged",
            });
          }} />} />}>
          {getFileIcon(getFileName(file.filePath), 16)}
          <span className={styles.fileName}>
            <span className={styles.fileBaseName}>{getFileName(file.filePath)}</span>
            {file.relativePath.includes("/") && <span className={styles.fileDirectory}>{file.relativePath.slice(0, file.relativePath.lastIndexOf("/"))}</span>}
          </span>
          <span className={styles.code} data-kind={file.status}>{file.status === "conflict" ? "!"
            : selected ? file.indexStatus : file.worktreeStatus === "?" ? "U" : file.worktreeStatus}</span>
        </ContextMenu.Trigger>
        <TooltipContent side="right" className="break-all">{file.relativePath}</TooltipContent>
        </Tooltip>
        <ContextMenu.Portal>
          <ContextMenu.Positioner className={styles.contextPositioner}>
            <ContextMenu.Popup className={styles.contextMenu}>
              <ContextMenu.Item className={styles.contextItem} disabled={!!busy || !!loadError || !file.canStage}
                onClick={() => void mutate(selected ? "unstage" : "stage", [file.relativePath])}>
                {t(selected ? "git.unstage" : "git.stage")}
              </ContextMenu.Item>
              <ContextMenu.Item className={styles.contextItem} disabled={!!busy || blocked || !file.canDiscard}
                onClick={() => { setError(null); setDiscard({ file, revision: workspace!.revision }); }}>
                {t("git.discard")}
              </ContextMenu.Item>
              <ContextMenu.Item className={styles.contextItem} disabled={!!busy || blocked || !file.canIgnore}
                onClick={() => void mutate("ignore", [file.relativePath])}>
                {t("git.ignore")}
              </ContextMenu.Item>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>)}
      </Collapse>
      </div>
    </div>
  };

  return <section className={styles.panel} aria-label="Git" aria-busy={loading || !!busy}>
    {loading && <div className={styles.history} style={{ padding: "10px 12px" }}>
      <FileListSkeleton label={t("i18n.loading")} />
    </div>}
    {workspace && <>
      {showHistory ? <div className={styles.history} aria-label={t("git.history")}>
        {workspace.commits.length ? <ol className={styles.commitList}>
          {workspace.commits.map((commit, index) => <li key={commit.hash} className={styles.commitRow}>
            <span className={styles.commitDot} aria-hidden="true" />
            <div className={styles.commitInfo}>
              <div className={styles.commitSubject} title={commit.subject}>{commit.subject}</div>
              <div className={styles.commitMeta}>
                <code title={commit.hash}>{commit.hash.slice(0, 7)}</code>
                <span title={commit.author}>{commit.author}</span>
                <time className={styles.commitDate} dateTime={commit.date} title={new Date(commit.date).toLocaleString(locale)}>
                  {new Date(commit.date).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </time>
                {index === 0 && <small className={styles.head}>HEAD</small>}
              </div>
            </div>
          </li>)}
        </ol> : <div className={styles.empty}>{t("git.noHistory")}</div>}
      </div> : <div className={styles.history} aria-label={t("git.changes")}>
        {workspace.files.length ? <>{renderGroup(staged, true)}{renderGroup(unstaged, false)}</>
          : <div className={styles.empty}><CheckIcon size={15} />{t("git.clean")}</div>}
      </div>}
      <div className={styles.branch} title={workspace.repositoryRoot}>
        <GitBranchIcon size={14} /><span>{workspace.branch ?? "Detached HEAD"}</span>
        <button type="button" className={styles.historyToggle} aria-pressed={showHistory}
          onClick={() => setShowHistory((value) => !value)}>{t("git.history")}</button>
        <DropdownMenu>
          <div className={styles.splitButton}>
            <button type="button" className={styles.splitMain} disabled={!!busy || !canCommit}
              onClick={() => openCommit("commit")}>
              {busy ? <LoaderCircleIcon size={13} className={styles.spinner} /> : <CheckIcon size={13} />}
              {t("git.commit")}{commitCount > 0 ? ` (${commitCount})` : ""}
            </button>
            <DropdownMenuTrigger render={<button type="button" className={styles.splitToggle} disabled={!!busy || !!loadError}
              aria-label={t("git.actions")}><ChevronDownIcon size={13} /></button>} />
          </div>
          <DropdownMenuContent align="end" className={styles.commitMenu}>
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={!canCommit} onClick={() => openCommit("commit")}>{t("git.commit")}</DropdownMenuItem>
              {!workspace.upstream && workspace.remotes.length > 1 ? <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!canCommit}>{t("git.commitPush")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className={styles.commitMenu}>
                  {workspace.remotes.map((name) => <DropdownMenuItem key={name} onClick={() => openCommit("commitPush", name)}>{name}</DropdownMenuItem>)}
                </DropdownMenuSubContent>
              </DropdownMenuSub> : <DropdownMenuItem disabled={!workspace.remotes.length || !canCommit}
                onClick={() => openCommit("commitPush")}>{t("git.commitPush")}</DropdownMenuItem>}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {workspace.upstream ? <DropdownMenuItem disabled={blocked || !workspace.head || !remote} onClick={() => void mutate("push")}>
                {t("git.push")}{workspace.ahead !== null && workspace.ahead > 0 ? ` (${workspace.ahead})` : ""}
              </DropdownMenuItem> : workspace.remotes.map((name) => <DropdownMenuItem key={name} disabled={blocked || !workspace.head}
                onClick={() => void mutate("push", undefined, { remote: name })}>{t("git.publishTo", { remote: name })}</DropdownMenuItem>)}
              {!workspace.remotes.length && <DropdownMenuItem disabled>{t("git.error.noRemote")}</DropdownMenuItem>}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog.Root open={commitOpen} onOpenChange={(open) => { if (!busyRef.current) setCommitOpen(open); }}>
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup className={`${styles.dialog} ${styles.commitDialog}`} initialFocus={messageRef}>
            <header className={styles.dialogHeader}>
              <Dialog.Title className={styles.dialogTitle}>{t("git.messageLabel")}</Dialog.Title>
              <Dialog.Close className={styles.close} disabled={!!busy} aria-label={t("git.close")}><XIcon size={17} /></Dialog.Close>
            </header>
            <form className={styles.dialogForm} onSubmit={(event) => { event.preventDefault(); if (!busy && canCommit && message.trim()) void mutate("commit"); }}>
              <div className={styles.composer}>
                {(workspace.operationInProgress || !workspace.branch || workspace.files.some((file) => file.status === "conflict"))
                  && <div className={styles.muted}>{t(workspace.operationInProgress ? "git.error.inProgress"
                    : !workspace.branch ? "git.error.detached" : "git.error.conflicts")}</div>}
                <Textarea id="git-commit-message" ref={messageRef} className={styles.messageInput} aria-label={t("git.messageLabel")} placeholder={t("git.message")} value={message}
                  disabled={!!busy} rows={4} maxLength={20000} onChange={(event) => saveMessage(event.target.value)} />
                {(error || loadError) && <div role="alert" className={styles.error}>{error || loadError}</div>}
                <div className={styles.commitActions}>
                  <Dialog.Close render={<Button type="button" variant="outline" size="sm" />} disabled={!!busy}>{t("sidebar.cancel")}</Dialog.Close>
                  <Button type="submit" variant="outline" size="sm" className={styles.commitSubmit} disabled={!!busy || !canCommit || !message.trim()}>
                    {busy === "commit" && <LoaderCircleIcon size={13} className={styles.spinner} />}
                    {t(commitMode === "commitPush" ? "git.commitPush" : "git.commit")}{commitCount > 0 ? ` (${commitCount})` : ""}
                  </Button>
                </div>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={!!discard} onOpenChange={(open) => { if (!open && !busyRef.current) setDiscard(null); }}>
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup className={styles.dialog} initialFocus={cancelDiscardRef}>
            <header className={styles.dialogHeader}><Dialog.Title className={styles.dialogTitle}>{t("git.discard")}</Dialog.Title></header>
            <div className={styles.composer}>
              <Dialog.Description className={styles.discardDescription}>{t("git.discardConfirm", { path: discard?.file.relativePath ?? "" })}</Dialog.Description>
              <div className={`${styles.actions} ${styles.dialogActions}`}>
                <Dialog.Close ref={cancelDiscardRef} disabled={!!busy}>{t("sidebar.cancel")}</Dialog.Close>
                <button type="button" disabled={!!busy} onClick={() => {
                  if (discard) void mutate("discard", [discard.file.relativePath], {
                    revision: discard.revision, expectedContentHash: discard.file.contentHash ?? undefined,
                  });
                }}>{busy === "discard" && <LoaderCircleIcon size={13} className={styles.spinner} />}{t("git.discard")}</button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>}
    {!commitOpen && <NotificationNotice message={error || loadError} />}
  </section>;
}
