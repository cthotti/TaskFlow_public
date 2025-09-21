// src/components/ExtractedTasks.tsx
"use client";
import { useEffect, useState } from "react";

type ExtractedTask = {
  _id?: string;
  title: string;
  description?: string;
  date?: string;
  time?: string;
  source_subject?: string;
  source_from?: string;
  confidence?: number;
  addedToCalendar?: boolean;
  _source_account?: string;
  source_email_ts?: string | null;
};

type ExtractedAccount = {
  _id?: string;
  email: string;
  lastEmailTs?: string | null;
  authenticated?: boolean;
};

const TASKS_API = "/api/extracted";
const ACCOUNTS_API = "/api/accounts";
const FASTAPI_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function ExtractedTasks() {
  const [tasks, setTasks] = useState<ExtractedTask[]>([]);
  const [accounts, setAccounts] = useState<ExtractedAccount[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [missingAuth, setMissingAuth] = useState<string[]>([]);
  const [authQueue, setAuthQueue] = useState<string[]>([]);
  const [authInProgress, setAuthInProgress] = useState<string | null>(null);

  // per-task loading states keyed by task._id
  const [taskLoading, setTaskLoading] = useState<Record<string, boolean>>({});

  // ---- Fetch Tasks ----
  const fetchTasks = async () => {
    try {
      const res = await fetch(TASKS_API);
      setTasks(res.ok ? await res.json() : []);
    } catch (e) {
      console.error("fetch extracted tasks failed", e);
      setTasks([]);
    }
  };

  // ---- Fetch Accounts ----
  const fetchAccounts = async () => {
    try {
      const res = await fetch(ACCOUNTS_API);
      setAccounts(res.ok ? await res.json() : []);
    } catch (e) {
      console.error("fetch accounts failed", e);
      setAccounts([]);
    }
  };

  // ---- Delete Task ----
  const deleteTask = async (id: string) => {
    if (!id) return;
    setTaskLoading((s) => ({ ...s, [id]: true }));
    try {
      const res = await fetch(`${TASKS_API}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const txt = await res.text().catch(() => "no response body");
        throw new Error(`Delete failed: ${res.status} ${txt}`);
      }
      // optimistically remove from UI
      setTasks((prev) => prev.filter((t) => t._id !== id));
    } catch (e) {
      console.error("deleteTask failed", e);
      alert("Failed to delete task. See console for details.");
    } finally {
      setTaskLoading((s) => ({ ...s, [id]: false }));
    }
  };

  // ---- Add to Calendar ----
  const addToCalendar = async (task: ExtractedTask) => {
    const id = task._id;
    if (!id) {
      console.warn("task has no _id, skipping add");
      return;
    }
    setTaskLoading((s) => ({ ...s, [id]: true }));

    try {
      // Build payload for calendar API. Use the backend-provided date/time.
      const payload: any = {
        text: task.title,
        description: task.description,
        date: task.date || null,
        due: task.time || null,
        // include source metadata so backend can attach it to the created calendar item if desired
        metadata: { source_account: task._source_account, source_email_ts: task.source_email_ts },
      };

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Calendar create failed: ${res.status} ${text}`);
      }

      // Optionally read the created event from the API response (if provided)
      const created = await res.json().catch(() => null);

      // Mark the extracted task as addedToCalendar in our DB via tasks API
      const patchRes = await fetch(TASKS_API, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, addedToCalendar: true }),
      });

      if (!patchRes.ok) {
        const text = await patchRes.text().catch(() => "");
        console.warn("Failed to mark task as added on server:", patchRes.status, text);
        // still update UI to reflect calendar add, but inform user
        alert("Event created but failed to update local task state.");
      } else {
        // Update local UI state for that task
        setTasks((prev) =>
          prev.map((t) => (t._id === id ? { ...t, addedToCalendar: true } : t))
        );
      }

      // refresh accounts/tasks to sync lastEmailTs if needed
      await fetchAccounts();
      await fetchTasks();

      console.info("Event created on calendar", created);
    } catch (e) {
      console.error("addToCalendar failed", e);
      alert("Failed to add to calendar. See console for details.");
    } finally {
      setTaskLoading((s) => ({ ...s, [id]: false }));
    }
  };

  // ---- Analyze via FastAPI ----
  const analyzeViaFastAPI = async (emails: string[]) => {
    setAnalyzeLoading(true);
    setMissingAuth([]);
    try {
      const res = await fetch(`${FASTAPI_BASE}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const data = await res.json();
      if (data && data.missing_auth) {
        setMissingAuth(data.missing_auth || []);
      } else {
        await fetchTasks();
        await fetchAccounts();
      }
    } catch (e) {
      console.error("analyze failed", e);
    } finally {
      setAnalyzeLoading(false);
    }
  };

  // ---- Request Auth ----
  const requestAuthFor = async (email: string) => {
    try {
      const res = await fetch(`${FASTAPI_BASE}/start_auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data?.auth_url) {
        setAuthInProgress(email);
        // redirect the user to Google's OAuth screen
        window.location.href = data.auth_url;
      } else {
        console.warn("start_auth returned no auth_url", data);
        alert("Failed to start auth. Check server logs.");
      }
    } catch (e) {
      console.error("start_auth failed", e);
      alert("Failed to start auth. See console.");
    }
  };

  useEffect(() => {
    // Handle OAuth callback landing here after redirect from FastAPI
    const url = new URL(window.location.href);
    const auth = url.searchParams.get("auth");
    const email = url.searchParams.get("email");
    if (auth === "success" && email) {
      // remove query params from URL for cleanliness
      window.history.replaceState({}, document.title, window.location.pathname);
      setAuthInProgress(null);
      setAuthQueue((prev) => {
        const remaining = prev.filter((e) => e !== email);
        if (remaining.length > 0) {
          requestAuthFor(remaining[0]);
        }
        return remaining;
      });
      // refresh accounts/tasks immediately
      fetchAccounts();
      fetchTasks();
    }

    fetchTasks();
    fetchAccounts();
  }, []);

  // ---- Connect: save accounts in DB (Next API), then request auth ----
  const onConnectClick = async () => {
    const emails = emailInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setAuthQueue(emails);

    // Save each email in Next.js DB first (so accounts show up instantly)
    for (const email of emails) {
      try {
        await fetch(ACCOUNTS_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
      } catch (e) {
        console.error("failed to save account via Next API", e);
      }
    }
    await fetchAccounts();

    // Begin auth with first email (if any)
    if (emails.length > 0) {
      await requestAuthFor(emails[0]);
    }
  };

  const onAnalyzeClick = async () => {
    const emails = emailInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await analyzeViaFastAPI(emails);
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold text-white mb-4">Extracted from Gmail</h2>

      {/* Input for emails */}
      <div className="mb-4">
        <label className="text-sm text-gray-300">Emails (comma separated)</label>
        <input
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          placeholder="you@example.com, other@domain.com"
          className="w-full p-2 mt-1 bg-[#0b0b0b] border border-gray-700 rounded text-white"
        />
        <div className="mt-2 flex space-x-2">
          <button onClick={onConnectClick} className="px-3 py-1 bg-blue-600 rounded">
            Connect
          </button>
          <button onClick={onAnalyzeClick} className="px-3 py-1 bg-green-600 rounded">
            {analyzeLoading ? "Analyzing..." : "Analyze"}
          </button>
          <button onClick={() => { fetchTasks(); fetchAccounts(); }} className="px-3 py-1 bg-gray-600 rounded">
            Refresh
          </button>
        </div>
      </div>

      {/* Connected Accounts */}
      <div className="mb-6">
        <h3 className="text-md font-semibold text-white mb-2">Connected Accounts</h3>
        {accounts.length === 0 ? (
          <p className="text-gray-400 text-sm">No accounts connected</p>
        ) : (
          <ul className="space-y-2">
            {accounts.map((acc) => (
              <li key={acc._id} className="bg-[#1e1e1e] border border-gray-600 rounded-md p-2 text-white flex justify-between">
                <div>
                  <div>{acc.email}</div>
                  <div className="text-xs text-gray-400">{acc.authenticated ? "connected" : "not connected"}</div>
                </div>
                <div className="text-xs text-gray-400">Last sync: {acc.lastEmailTs || "never"}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Tasks */}
      <div className="space-y-3">
        <h3 className="text-md font-semibold text-white mb-2">Extracted Tasks</h3>
        {tasks.length === 0 ? (
          <p className="text-gray-400 text-sm">No extracted tasks</p>
        ) : (
          tasks.map((t) => {
            const id = t._id || `${t._source_account}-${t.source_email_ts}-${t.title}`;
            const loading = !!taskLoading[id];
            return (
              <div key={id} className="bg-[#1e1e1e] border border-gray-600 rounded-md p-3 text-white flex justify-between items-center">
                <div>
                  <p className="font-medium">{t.title}</p>
                  {t.description && <p className="text-xs text-gray-400">{t.description}</p>}
                  {t.date && <p className="text-xs text-gray-500">Due: {t.date} {t.time ?? ""}</p>}
                  <p className="text-xs text-gray-500">From: {t.source_from} ({t._source_account})</p>
                </div>
                <div className="flex space-x-2 text-xs">
                  {!t.addedToCalendar && (
                    <button
                      onClick={() => addToCalendar(t)}
                      className="px-2 py-1 bg-green-600 hover:bg-green-500 rounded disabled:opacity-50"
                      disabled={loading}
                    >
                      {loading ? "Adding..." : "Add"}
                    </button>
                  )}
                  <button
                    onClick={() => deleteTask(id)}
                    className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded disabled:opacity-50"
                    disabled={loading}
                  >
                    {loading ? "…" : "×"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
