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
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"; // FastAPI backend

export default function ExtractedTasks() {
  const [tasks, setTasks] = useState<ExtractedTask[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [missingAuth, setMissingAuth] = useState<string[]>([]);
  const [authUrls, setAuthUrls] = useState<Record<string, string>>({});

  const fetchTasks = async () => {
    try {
      const res = await fetch(`${API_URL}/email_state`);
      if (!res.ok) {
        setTasks([]);
        return;
      }
      const data = await res.json();
      // data is { account: [items...] }
      const flat: ExtractedTask[] = [];
      Object.keys(data || {}).forEach((acc) => {
        (data[acc] || []).forEach((it: any) => flat.push(it));
      });
      setTasks(flat);
    } catch (e) {
      console.error("fetch email_state failed", e);
      setTasks([]);
    }
  };

  const deleteTask = async (id: string) => {
    await fetch(`${API_URL}/email_state?id=${id}`, { method: "DELETE" });
    await fetchTasks();
  };

  const addToCalendar = async (task: ExtractedTask) => {
    // 1. add to Next.js tasks DB
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

    // 2. update extracted as added (FastAPI)
    await fetch(`${API_URL}/email_state`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task._id, addedToCalendar: true }),
    });

    await fetchTasks();
  };

  const requestAuthFor = async (email: string) => {
    try {
      const res = await fetch(`${API_URL}/start_auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.auth_url) {
        // open in new tab
        window.open(data.auth_url, "_blank");
        setAuthUrls((p) => ({ ...p, [email]: data.auth_url }));
      } else {
        console.warn("no auth_url returned", data);
      }
    } catch (e) {
      console.error("start_auth failed", e);
    }
  };

  const analyzeEmails = async (emails: string[]) => {
    setAnalyzeLoading(true);
    setMissingAuth([]);
    setAuthUrls({});
    try {
      const res = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const data = await res.json();

      // If backend returns missing_auth, surface that
      if (data && data.missing_auth) {
        setMissingAuth(data.missing_auth || []);
        // Optionally generate auth URLs immediately for them:
        for (const e of data.missing_auth) {
          // ask backend to produce auth url; store it
          const r = await fetch(`${API_URL}/start_auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: e }),
          });
          const j = await r.json();
          if (j.auth_url) setAuthUrls((p) => ({ ...p, [e]: j.auth_url }));
        }
        setAnalyzeLoading(false);
        return;
      }

      // Otherwise data is mapping { account: items... } — refresh view by fetching /email_state
      await fetchTasks();
    } catch (e) {
      console.error("analyze failed", e);
    } finally {
      setAnalyzeLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const onConnectClick = async () => {
    // take emails from input (comma separated)
    const emails = emailInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const e of emails) {
      await requestAuthFor(e);
    }
    // give user time to auth and then they should hit Analyze
  };

  const onAnalyzeClick = async () => {
    const emails = emailInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await analyzeEmails(emails);
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
          <button onClick={onConnectClick} className="px-3 py-1 bg-blue-600 rounded">Connect</button>
          <button onClick={onAnalyzeClick} className="px-3 py-1 bg-green-600 rounded">
            {analyzeLoading ? "Analyzing..." : "Analyze"}
          </button>
          <button onClick={fetchTasks} className="px-3 py-1 bg-gray-600 rounded">Refresh</button>
        </div>
      </div>

      {missingAuth.length > 0 && (
        <div className="mb-3 p-3 bg-[#111] border border-yellow-700 rounded">
          <div className="text-sm mb-2 text-yellow-200">Missing authorization for these accounts:</div>
          <div className="flex flex-col space-y-2">
            {missingAuth.map((m) => (
              <div key={m} className="flex items-center justify-between">
                <div className="text-sm">{m}</div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => {
                      // open the auth url if we already fetched one
                      if (authUrls[m]) window.open(authUrls[m], "_blank");
                      else requestAuthFor(m);
                    }}
                    className="px-2 py-1 bg-orange-600 rounded"
                  >
                    Connect
                  </button>
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
