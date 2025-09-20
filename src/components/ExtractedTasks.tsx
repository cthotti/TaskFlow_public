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

const NEXT_API = "/api/extracted";
const FASTAPI_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"; // kept for auth endpoints

export default function ExtractedTasks() {
  const [tasks, setTasks] = useState<ExtractedTask[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [missingAuth, setMissingAuth] = useState<string[]>([]);
  const [authQueue, setAuthQueue] = useState<string[]>([]);
  const [authInProgress, setAuthInProgress] = useState<string | null>(null);

  // Fetch from Next API (DB-backed)
  const fetchTasks = async () => {
    try {
      const res = await fetch(NEXT_API);
      if (!res.ok) {
        setTasks([]);
        return;
      }
      const data = await res.json();
      setTasks(data || []);
    } catch (e) {
      console.error("fetch extracted tasks failed", e);
      setTasks([]);
    }
  };

  // Delete uses Next API
  const deleteTask = async (id: string) => {
    await fetch(`${NEXT_API}?id=${id}`, { method: "DELETE" });
    await fetchTasks();
  };

  // Add to calendar: create a task in your Tasks DB and mark extracted as added
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

    await fetch(NEXT_API, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task._id, addedToCalendar: true }),
    });

    await fetchTasks();
  };

  // Start backend analyze (FastAPI) - that service should call Next /api/extracted?action=ingest afterwards.
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
      // if FastAPI returns missing_auth, show it (FastAPI should return missing_auth)
      if (data && data.missing_auth) {
        setMissingAuth(data.missing_auth || []);
      } else {
        // After FastAPI analyzed, it should have saved and/or called ingest; we will just refresh
        await fetchTasks();
      }
    } catch (e) {
      console.error("analyze failed", e);
    } finally {
      setAnalyzeLoading(false);
    }
  };

  // Request auth via FastAPI (keeps existing flow)
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
        // redirect user (keeps sequential approach)
        window.location.href = data.auth_url;
      } else {
        console.warn("no auth_url returned", data);
      }
    } catch (e) {
      console.error("start_auth failed", e);
    }
  };

  // If you want the frontend to directly call Next ingest (optional)
  // call POST /api/extracted?action=ingest with accounts payload returned from FastAPI analysis.

  useEffect(() => {
    // detect OAuth callback from FastAPI (frontend redirect after auth returns to FRONTEND_URL/?auth=success&email=...)
    const url = new URL(window.location.href);
    const auth = url.searchParams.get("auth");
    const email = url.searchParams.get("email");
    if (auth === "success" && email) {
      console.log("Authorized:", email);
      window.history.replaceState({}, document.title, "/");
      setAuthInProgress(null);
      setAuthQueue((prev) => {
        const remaining = prev.filter((e) => e !== email);
        if (remaining.length > 0) {
          // trigger auth for next
          requestAuthFor(remaining[0]);
        }
        return remaining;
      });
    }

    fetchTasks();
  }, []);

  const onConnectClick = async () => {
    const emails = emailInput.split(",").map((s) => s.trim()).filter(Boolean);
    setAuthQueue(emails);
    if (emails.length > 0) {
      await requestAuthFor(emails[0]);
    }
  };

  const onAnalyzeClick = async () => {
    const emails = emailInput.split(",").map((s) => s.trim()).filter(Boolean);
    // use FastAPI analyze route which will call the AI pipeline and should call Next ingest
    await analyzeViaFastAPI(emails);
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold text-white mb-2">Extracted from Gmail</h2>

      <div className="mb-3">
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
          <button onClick={fetchTasks} className="px-3 py-1 bg-gray-600 rounded">Refresh</button>
        </div>
      </div>

      {authInProgress && (
        <div className="mb-3 p-3 bg-[#111] border border-blue-700 rounded">
          <div className="text-sm text-blue-200">Authorizing: {authInProgress}...</div>
        </div>
      )}

      {missingAuth.length > 0 && (
        <div className="mb-3 p-3 bg-[#111] border border-yellow-700 rounded">
          <div className="text-sm mb-2 text-yellow-200">Missing authorization for these accounts:</div>
          <div className="flex flex-col space-y-2">
            {missingAuth.map((m) => (
              <div key={m} className="flex items-center justify-between">
                <div className="text-sm">{m}</div>
                <div className="flex space-x-2">
                  <button onClick={() => requestAuthFor(m)} className="px-2 py-1 bg-orange-600 rounded">Connect</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
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
