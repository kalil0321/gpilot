"use client";

import { ChevronsUpDown, PanelLeftClose, PanelLeftOpen, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useThreads } from "@copilotkit/react-core/v2";
import { Logo } from "@/components/brand/Logo";
import styles from "./threads-drawer.module.css";

export interface ThreadsDrawerProps {
  agentId: string;
  threadId: string | undefined;
  onThreadChange: (threadId: string | undefined) => void;
  /** Controlled open state. Omit for the previous uncontrolled behaviour
   *  (drawer manages its own state, defaults to open). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface DrawerThread {
  id: string;
  name: string | null;
  updatedAt: string;
  archived: boolean;
  lastRunAt?: string;
}

const THREAD_ENTRY_ANIMATION_MS = 420;
const TITLE_ANIMATION_MS = 360;
const UNTITLED_THREAD_LABEL = "New thread";
const PREVIOUS_THREADS_HEADING = "Previous threads";

/** Mock account — replace with real auth / profile later. */
const MOCK_USER = {
  name: "Demo user",
  email: "you@example.com",
  initials: "DU",
} as const;

function MockUserButton({ variant }: { variant: "expanded" | "collapsed" }) {
  if (variant === "collapsed") {
    return (
      <button
        aria-label={`Account: ${MOCK_USER.name} (mock)`}
        className={styles.mockUserButtonCollapsed}
        title={`${MOCK_USER.name} · mock`}
        type="button"
      >
        <span className={styles.mockUserAvatarSmall} aria-hidden>
          {MOCK_USER.initials}
        </span>
      </button>
    );
  }

  return (
    <button
      aria-label={`Account: ${MOCK_USER.name} (mock)`}
      className={styles.mockUserButton}
      title={`${MOCK_USER.name} · mock`}
      type="button"
    >
      <span className={styles.mockUserAvatar} aria-hidden>
        {MOCK_USER.initials}
      </span>
      <span className={styles.mockUserText}>
        <span className={styles.mockUserName}>{MOCK_USER.name}</span>
        <span className={styles.mockUserEmail}>{MOCK_USER.email}</span>
      </span>
      <ChevronsUpDown
        aria-hidden
        className={styles.mockUserCaret}
        size={14}
        strokeWidth={2}
      />
    </button>
  );
}

function formatRelativeTime(isoTimestamp: string): string {
  const timestamp = new Date(isoTimestamp);
  if (Number.isNaN(timestamp.getTime())) return "Recently";

  const diffMs = Date.now() - timestamp.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.round(diffDay / 7)}w ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function formatAbsoluteTime(isoTimestamp: string): string {
  const timestamp = new Date(isoTimestamp);
  if (Number.isNaN(timestamp.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function cx(...classNames: Array<string | false | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

export default function ThreadsDrawer({
  agentId,
  threadId,
  onThreadChange,
  open: openProp,
  onOpenChange,
}: ThreadsDrawerProps) {
  // Controlled when `openProp` is supplied; otherwise uncontrolled with
  // a sensible default of open.
  const [internalOpen, setInternalOpen] = useState(true);
  const isOpen = openProp ?? internalOpen;
  const setIsOpen = (next: boolean) => {
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const deleteTriggerRef = useRef<HTMLElement | null>(null);

  const {
    threads,
    deleteThread,
    error,
    isLoading,
    hasMoreThreads,
    isFetchingMoreThreads,
    fetchMoreThreads,
  } = useThreads({
    agentId,
    includeArchived: false,
    limit: 20,
  });

  const hasMountedRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);
  const stableThreadsRef = useRef<DrawerThread[]>(threads);
  const previousThreadIdsRef = useRef<Set<string>>(new Set());
  const previousNamesRef = useRef<Map<string, string | null>>(new Map());
  const entryTimeoutsRef = useRef<Map<string, number>>(new Map());
  const titleTimeoutsRef = useRef<Map<string, number>>(new Map());

  if (!isLoading) {
    hasLoadedOnceRef.current = true;
    stableThreadsRef.current = threads;
  }
  const displayThreads: DrawerThread[] =
    isLoading && hasLoadedOnceRef.current ? stableThreadsRef.current : threads;
  const [enteringThreadIds, setEnteringThreadIds] = useState<
    Record<string, true>
  >({});
  const [revealedTitleIds, setRevealedTitleIds] = useState<
    Record<string, true>
  >({});

  useEffect(() => {
    return () => {
      for (const timeoutId of entryTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      for (const timeoutId of titleTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    // Skip diffing while the store is refetching (e.g. after a filter change
    // clears the list). Otherwise every thread would be treated as newly
    // added once the new page lands.
    if (isLoading) return;

    const nextThreadIds = new Set(threads.map((t) => t.id));

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      previousThreadIdsRef.current = nextThreadIds;
      previousNamesRef.current = new Map(threads.map((t) => [t.id, t.name]));
      return;
    }

    const addedThreadIds = threads
      .filter((t) => !previousThreadIdsRef.current.has(t.id))
      .map((t) => t.id);

    if (addedThreadIds.length > 0) {
      setEnteringThreadIds((current) => {
        const next = { ...current };
        for (const id of addedThreadIds) {
          next[id] = true;
          const existing = entryTimeoutsRef.current.get(id);
          if (existing !== undefined) window.clearTimeout(existing);
          const tid = window.setTimeout(() => {
            setEnteringThreadIds((s) => {
              const updated = { ...s };
              delete updated[id];
              return updated;
            });
            entryTimeoutsRef.current.delete(id);
          }, THREAD_ENTRY_ANIMATION_MS);
          entryTimeoutsRef.current.set(id, tid);
        }
        return next;
      });
    }

    const renamedThreadIds = threads
      .filter((t) => {
        // Only reveal when an already-tracked thread's name transitions from
        // null → named. Threads appearing for the first time (e.g. on a
        // filter switch) already have their final name and should not trigger
        // the title reveal animation — that would layer a blur/translateY
        // onto the row's enter animation and produce a visible jitter.
        if (!previousNamesRef.current.has(t.id)) return false;
        const prev = previousNamesRef.current.get(t.id) ?? null;
        return prev === null && t.name !== null;
      })
      .map((t) => t.id);

    if (renamedThreadIds.length > 0) {
      setRevealedTitleIds((current) => {
        const next = { ...current };
        for (const id of renamedThreadIds) {
          next[id] = true;
          const existing = titleTimeoutsRef.current.get(id);
          if (existing !== undefined) window.clearTimeout(existing);
          const tid = window.setTimeout(() => {
            setRevealedTitleIds((s) => {
              const updated = { ...s };
              delete updated[id];
              return updated;
            });
            titleTimeoutsRef.current.delete(id);
          }, TITLE_ANIMATION_MS);
          titleTimeoutsRef.current.set(id, tid);
        }
        return next;
      });
    }

    previousThreadIdsRef.current = nextThreadIds;
    previousNamesRef.current = new Map(threads.map((t) => [t.id, t.name]));
  }, [threads, isLoading]);

  const isInitialLoading = isLoading && !hasLoadedOnceRef.current;
  if (error) {
    console.error("Unable to load threads", error);
  }

  if (!isOpen) {
    return (
      <aside
        aria-label="Threads drawer"
        className={cx(styles.drawer, styles.drawerClosed)}
      >
        <div className={styles.collapsedRail}>
          <div className={styles.collapsedRailLeading}>
            <div
              className={cx(
                styles.drawerChromeRow,
                styles.drawerChromeRowCollapsedRail,
              )}
            >
              <button
                aria-label="Open threads drawer (⌘B)"
                title="Open drawer (⌘B)"
                className={cx(styles.iconButton, styles.drawerToggleButton)}
                type="button"
                onClick={() => setIsOpen(true)}
              >
                <PanelLeftOpen size={18} />
              </button>
            </div>
            <div className={styles.collapsedNewChatWrap}>
              <button
                aria-label="New chat"
                title="New chat"
                className={styles.iconButton}
                type="button"
                onClick={() => onThreadChange(undefined)}
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
          <div className={styles.collapsedRailBottom}>
            <MockUserButton variant="collapsed" />
          </div>
        </div>
      </aside>
    );
  }

  const closeDeleteDialog = () => {
    setPendingDelete(null);
    const trigger = deleteTriggerRef.current;
    deleteTriggerRef.current = null;
    trigger?.focus?.();
  };

  return (
    <>
      <aside
        aria-label="Threads drawer"
        className={cx(styles.drawer, styles.drawerOpen)}
      >
        <div aria-hidden className={styles.ambientGlow} />

        <div className={styles.drawerSurface}>
          <div className={styles.topBar}>
            <div className={styles.drawerChromeRow}>
              <button
                aria-label="gpilot — new chat"
                className={cx(
                  styles.drawerBrandButtonOpen,
                  styles.drawerBrandInChrome,
                )}
                title="New chat"
                type="button"
                onClick={() => onThreadChange(undefined)}
              >
                <Logo mono className={styles.drawerBrandLogoOpen} />
              </button>
              <button
                aria-label="Collapse threads drawer"
                title="Collapse drawer"
                className={cx(styles.iconButton, styles.drawerToggleButton)}
                type="button"
                onClick={() => setIsOpen(false)}
              >
                <PanelLeftClose size={18} />
              </button>
            </div>
            <div className={styles.newChatToolbarRow}>
              <button
                aria-label="New chat"
                className={styles.newChatButton}
                type="button"
                onClick={() => onThreadChange(undefined)}
              >
                <span className={styles.newChatButtonInner}>
                  <Plus
                    size={16}
                    aria-hidden
                    className={styles.newChatButtonIcon}
                  />
                  <span>New chat</span>
                </span>
              </button>
            </div>
            <p
              className={styles.threadListSectionLabel}
              id="threads-drawer-previous-heading"
            >
              {PREVIOUS_THREADS_HEADING}
            </p>
          </div>

          <div className={styles.drawerContent}>
            {error ? (
              <div className={styles.emptyState}>
                <p className={styles.emptyTitle}>
                  Couldn&rsquo;t load threads
                </p>
                <p className={styles.emptyMessage}>
                  The thread list failed to load. Try reloading the page.
                </p>
                <button
                  className={styles.loadMoreButton}
                  type="button"
                  onClick={() => window.location.reload()}
                >
                  Reload
                </button>
              </div>
            ) : isInitialLoading ? (
              <div
                aria-busy="true"
                aria-label="Loading threads"
                className={styles.loadingList}
                role="status"
              >
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={styles.loadingRow}>
                    <span className={styles.loadingTitleBar} />
                    <span className={styles.loadingMetaBar} />
                  </div>
                ))}
              </div>
            ) : displayThreads.length === 0 ? (
              <div className={styles.emptyState}>
                <p className={styles.emptyMessage}>
                  No threads yet. Start a new chat to begin.
                </p>
              </div>
            ) : (
              <div
                aria-labelledby="threads-drawer-previous-heading"
                className={styles.threadList}
                role="region"
              >
                {displayThreads.map((thread) => {
                  const hasTitle = thread.name !== null;
                  const title = thread.name ?? UNTITLED_THREAD_LABEL;
                  const stamp = thread.lastRunAt ?? thread.updatedAt;

                  return (
                    <div key={thread.id} className={styles.threadRow}>
                      <button
                        aria-current={
                          threadId === thread.id ? "page" : undefined
                        }
                        className={cx(
                          styles.threadItem,
                          threadId === thread.id && styles.threadItemSelected,
                          enteringThreadIds[thread.id] &&
                            styles.threadItemAnimatingIn,
                          thread.archived && styles.threadItemArchived,
                        )}
                        type="button"
                        onClick={() => onThreadChange(thread.id)}
                      >
                        <span className={styles.threadBody}>
                          <span
                            className={cx(
                              styles.threadTitle,
                              !hasTitle && styles.threadTitlePlaceholder,
                              revealedTitleIds[thread.id] &&
                                styles.threadTitleAnimated,
                            )}
                          >
                            {title}
                          </span>
                          <span className={styles.threadRowSep} aria-hidden>
                            ·
                          </span>
                          <span
                            className={styles.threadMeta}
                            title={formatAbsoluteTime(stamp)}
                          >
                            {formatRelativeTime(stamp)}
                          </span>
                        </span>
                      </button>
                      <div className={styles.threadActions}>
                        <button
                          aria-label={`Delete ${title}`}
                          className={cx(
                            styles.iconButton,
                            styles.threadActionButton,
                            styles.deleteButton,
                          )}
                          type="button"
                          onClick={(e) => {
                            deleteTriggerRef.current = e.currentTarget;
                            setPendingDelete({ id: thread.id, title });
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {hasMoreThreads && (
                  <button
                    className={styles.loadMoreButton}
                    disabled={isFetchingMoreThreads}
                    type="button"
                    onClick={fetchMoreThreads}
                  >
                    {isFetchingMoreThreads ? "Loading…" : "Load more"}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={styles.drawerFooter}>
            <MockUserButton variant="expanded" />
          </div>
        </div>
      </aside>
      {pendingDelete && (
        <ConfirmDialog
          confirmLabel="Delete"
          description={`Delete "${pendingDelete.title}"? This cannot be undone.`}
          destructive
          title="Delete thread"
          onCancel={closeDeleteDialog}
          onConfirm={() => {
            const { id } = pendingDelete;
            closeDeleteDialog();
            if (threadId === id) onThreadChange(undefined);
            deleteThread(id).catch((err: unknown) => {
              console.error("Unable to delete thread", err);
            });
          }}
        />
      )}
    </>
  );
}

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={styles.dialogOverlay}
      role="presentation"
      onClick={onCancel}
    >
      <div
        aria-describedby={descId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.dialog}
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.dialogTitle} id={titleId}>
          {title}
        </h3>
        <p className={styles.dialogDescription} id={descId}>
          {description}
        </p>
        <div className={styles.dialogActions}>
          <button
            autoFocus
            className={cx(styles.dialogButton, styles.dialogButtonSecondary)}
            type="button"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className={cx(
              styles.dialogButton,
              destructive
                ? styles.dialogButtonDestructive
                : styles.dialogButtonPrimary,
            )}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
