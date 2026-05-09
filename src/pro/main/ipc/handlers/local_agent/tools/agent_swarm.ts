/**
 * In-process agent swarm — file-based mailboxes are replaced with a simple
 * in-memory Map since all sub-agents run inside the same Node.js process.
 *
 * Supports:
 *  - Named agent registration
 *  - Fire-and-forget messaging (send / broadcast)
 *  - Blocking wait (waitForMessage — Promise resolves when a matching message arrives)
 *  - Permission bridge (requestPermission — routes sub-agent consent requests to
 *    the leader's consent handler, which shows the real Electron consent UI)
 */
import crypto from "node:crypto";

export type AgentMessageType =
  | "text"
  | "task"
  | "report"
  | "question"
  | "answer"
  | "permission_request"
  | "permission_response";

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: AgentMessageType;
  content: string;
  timestamp: number;
  read: boolean;
}

interface MessageWaiter {
  /** If set, only wake for messages from this sender */
  from?: string;
  resolve: (msg: AgentMessage | null) => void;
}

export type AgentLifecycleStatus = "running" | "completed" | "failed";

export interface AgentLifecycleState {
  status: AgentLifecycleStatus;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export class AgentSwarm {
  private mailboxes = new Map<string, AgentMessage[]>();
  private waiters = new Map<string, MessageWaiter[]>();
  private lifecycle = new Map<string, AgentLifecycleState>();

  /**
   * Called by the leader to handle permission requests from workers.
   * Returns true if the tool should be allowed, false to deny.
   */
  private permissionHandler?: (
    fromAgent: string,
    toolName: string,
    inputPreview: string,
  ) => Promise<boolean>;

  // ── Registration & Lifecycle ───────────────────────────────────────────────

  /** Register an agent — idempotent, safe to call multiple times */
  register(name: string): void {
    if (!this.mailboxes.has(name)) {
      this.mailboxes.set(name, []);
    }
  }

  /** Mark agent as running (called when execution starts) */
  markRunning(name: string): void {
    this.lifecycle.set(name, { status: "running", startedAt: Date.now() });
  }

  /** Mark agent as completed successfully */
  markCompleted(name: string): void {
    const prev = this.lifecycle.get(name);
    this.lifecycle.set(name, {
      status: "completed",
      startedAt: prev?.startedAt ?? Date.now(),
      endedAt: Date.now(),
    });
  }

  /** Mark agent as failed with an error message */
  markFailed(name: string, error: string): void {
    const prev = this.lifecycle.get(name);
    this.lifecycle.set(name, {
      status: "failed",
      error,
      startedAt: prev?.startedAt ?? Date.now(),
      endedAt: Date.now(),
    });
  }

  /** Get lifecycle state for a specific agent */
  getLifecycle(name: string): AgentLifecycleState | undefined {
    return this.lifecycle.get(name);
  }

  /** Get lifecycle states for all non-leader agents */
  getAllAgentLifecycles(): Map<string, AgentLifecycleState> {
    const result = new Map<string, AgentLifecycleState>();
    for (const [name, state] of this.lifecycle) {
      if (name !== "leader") result.set(name, state);
    }
    return result;
  }

  /** Names of all registered agents */
  get agentNames(): string[] {
    return [...this.mailboxes.keys()];
  }

  // ── Messaging ──────────────────────────────────────────────────────────────

  /** Send a message from one agent to another */
  send(
    from: string,
    to: string,
    type: AgentMessageType,
    content: string,
  ): void {
    if (!this.mailboxes.has(to)) {
      this.mailboxes.set(to, []);
    }
    const msg: AgentMessage = {
      id: crypto.randomUUID(),
      from,
      to,
      type,
      content,
      timestamp: Date.now(),
      read: false,
    };
    this.mailboxes.get(to)!.push(msg);

    // Wake the first matching waiter for this inbox (FIFO)
    const waiters = this.waiters.get(to) ?? [];
    const idx = waiters.findIndex((w) => !w.from || w.from === from);
    if (idx !== -1) {
      const [waiter] = waiters.splice(idx, 1);
      msg.read = true; // delivered directly — mark read
      waiter.resolve(msg);
    }
  }

  /** Broadcast to all registered agents except the sender */
  broadcast(from: string, type: AgentMessageType, content: string): void {
    for (const name of this.mailboxes.keys()) {
      if (name !== from) {
        this.send(from, name, type, content);
      }
    }
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  /**
   * Return all unread messages for an agent and mark them as read.
   * Returns an empty array if the inbox doesn't exist yet.
   */
  readUnread(name: string): AgentMessage[] {
    const msgs = this.mailboxes.get(name) ?? [];
    const unread = msgs.filter((m) => !m.read);
    unread.forEach((m) => (m.read = true));
    return unread;
  }

  /** Return all messages (read + unread) without mutating read state */
  readAll(name: string): AgentMessage[] {
    return [...(this.mailboxes.get(name) ?? [])];
  }

  // ── Blocking wait ──────────────────────────────────────────────────────────

  /**
   * Block until a message arrives in `agentName`'s inbox (optionally filtered
   * by sender), or until `timeoutMs` elapses.
   *
   * Checks existing unread messages first so callers never miss a message that
   * arrived before wait_for_reply was called.
   *
   * Returns null on timeout.
   */
  waitForMessage(
    agentName: string,
    opts: { from?: string; timeoutMs: number; signal?: AbortSignal },
  ): Promise<AgentMessage | null> {
    // Check if a matching unread message is already in the inbox
    const msgs = this.mailboxes.get(agentName) ?? [];
    const existing = msgs.find(
      (m) => !m.read && (!opts.from || m.from === opts.from),
    );
    if (existing) {
      existing.read = true;
      return Promise.resolve(existing);
    }

    // If already aborted, don't wait
    if (opts.signal?.aborted) {
      return Promise.resolve(null);
    }

    return new Promise<AgentMessage | null>((resolve) => {
      const waiter: MessageWaiter = { from: opts.from, resolve };

      const cleanup = () => {
        clearTimeout(timer);
        const list = this.waiters.get(agentName) ?? [];
        const idx = list.indexOf(waiter);
        if (idx !== -1) list.splice(idx, 1);
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, opts.timeoutMs);

      opts.signal?.addEventListener(
        "abort",
        () => {
          cleanup();
          resolve(null);
        },
        { once: true },
      );

      waiter.resolve = (msg) => {
        clearTimeout(timer);
        resolve(msg);
      };

      if (!this.waiters.has(agentName)) {
        this.waiters.set(agentName, []);
      }
      this.waiters.get(agentName)!.push(waiter);
    });
  }

  // ── Permission bridge ──────────────────────────────────────────────────────

  /**
   * Register the leader's consent handler.
   * Called once during session setup in local_agent_handler.ts.
   */
  setPermissionHandler(
    handler: (
      fromAgent: string,
      toolName: string,
      inputPreview: string,
    ) => Promise<boolean>,
  ): void {
    this.permissionHandler = handler;
  }

  /**
   * Sub-agent calls this when a tool requires consent.
   * Routes the request through the leader's consent handler (which shows the
   * real Electron consent UI to the user).  Logs the request/response as swarm
   * messages so other agents can observe the audit trail via read_messages.
   */
  async requestPermission(
    fromAgent: string,
    toolName: string,
    inputPreview: string,
  ): Promise<boolean> {
    // Log the request in the swarm audit trail
    this.send(
      fromAgent,
      "leader",
      "permission_request",
      JSON.stringify({ toolName, inputPreview }),
    );

    const allowed = this.permissionHandler
      ? await this.permissionHandler(fromAgent, toolName, inputPreview)
      : true; // fallback: auto-approve if no handler registered

    // Log the response
    this.send(
      "leader",
      fromAgent,
      "permission_response",
      JSON.stringify({ toolName, allowed }),
    );

    return allowed;
  }
}
