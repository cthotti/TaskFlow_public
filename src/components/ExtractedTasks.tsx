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
    await fetch(`${TASKS_API}?id=${id}`, { method: "DELETE" });
    await fetchTasks();
  };

  // ---- Add to Calendar ----
  const addToCalendar = async (task: ExtractedTask) => {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: task.title,
        description: task.description,
        due: task.time,
        date: task.date,
      }),
    });

    await fetch(TASKS_API, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task._id, addedToCalendar: true }),
    });

    await fetchTasks();
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
      if (data.auth_url) {
        setAuthInProgress(email);
        window.location.href = data.auth_url;
      }
    } catch (e) {
      console.error("start_auth failed", e);
    }
  };

  useEffect(() => {
    // Handle OAuth callback
    const url = new URL(window.location.href);
    const auth = url.searchParams.get("auth");
    const email = url.searchParams.get("email");
    if (auth === "success" && email) {
      window.history.replaceState({}, document.title, "/");
      setAuthInProgress(null);
      setAuthQueue((prev) => {
        const remaining = prev.filter((e) => e !== email);
        if (remaining.length > 0) requestAuthFor(remaining[0]);
        return remaining;
      });
      fetchAccounts();
    }

    fetchTasks();
    fetchAccounts();
  }, []);

  // ---- Connect: save accounts in DB, then request auth ----
  const onConnectClick = async () => {
    const emails = emailInput.split(",").map((s) => s.trim()).filter(Boolean);
    setAuthQueue(emails);

    // Save each email in Mongo first
    for (const email of emails) {
      await fetch(ACCOUNTS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    }
    await fetchAccounts();

    // Begin auth with first email
    if (emails.length > 0) await requestAuthFor(emails[0]);
  };

  const onAnalyzeClick = async () => {
    const emails = emailInput.split(",").map((s) => s.trim()).filter(Boolean);
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
          <button onClick={() => {fetchTasks(); fetchAccounts();}} className="px-3 py-1 bg-gray-600 rounded">
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
                <span>{acc.email}</span>
                <span className="text-xs text-gray-400">Last sync: {acc.lastEmailTs || "never"}</span>
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
          tasks.map((t) => (
            <div key={t._id} className="bg-[#1e1e1e] border border-gray-600 rounded-md p-3 text-white flex justify-between items-center">
              <div>
                <p className="font-medium">{t.title}</p>
                {t.description && <p className="text-xs text-gray-400">{t.description}</p>}
                {t.date && <p className="text-xs text-gray-500">Due: {t.date} {t.time ?? ""}</p>}
                <p className="text-xs text-gray-500">From: {t.source_from} ({t._source_account})</p>
              </div>
              <div className="flex space-x-2 text-xs">
                {!t.addedToCalendar && (
                  <button onClick={() => addToCalendar(t)} className="px-2 py-1 bg-green-600 hover:bg-green-500 rounded">Add</button>
                )}
                <button onClick={() => deleteTask(t._id!)} className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded">×</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
