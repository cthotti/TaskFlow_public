"use client";
import { useState } from "react";
import TodoList from "@/components/TodoList";
import Sidebar from "@/components/Sidebar";
import Calendar from "@/components/Calendar";
import ExtractedTasks from "@/components/ExtractedTasks";

export default function Home() {
  const [showExtracted, setShowExtracted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callBackend = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // no input required for now
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to analyze emails.");
        return;
      }

      // ✅ Success: show ExtractedTasks component
      setShowExtracted(true);
      setError(null);
    } catch (err: any) {
      console.error("Analyze error:", err);
      setError("Unexpected error running analyzer.");
    }
  };

  return (
    <div className="flex min-h-screen bg-[#0B0909] text-white">
      {/* Sidebar */}
      <Sidebar />

      {/* Divider */}
      <div className="w-[1px] bg-gray-600" />

      {/* Main content area */}
      <div className="flex-1 flex flex-col p-10">
        <h1 className="text-4xl text-center mb-6 font-bold text-[#EAEAEA]">
          Cal∀Stdnts
        </h1>

        {/* Task features */}
        <TodoList />

        {/* Gmail Analyzer Section */}
        <div className="text-center mt-10">
          <h2 className="text-2xl mb-4">Gmail Analyzer</h2>
          <button
            onClick={callBackend}
            className="bg-green-600 hover:bg-green-700 px-6 py-2 rounded-lg"
          >
            Analyze Emails
          </button>
          {error && <p className="mt-4 text-red-400">{error}</p>}
        </div>

        {/* ✅ Extracted Tasks Section */}
        {showExtracted && (
          <div className="mt-6">
            <ExtractedTasks />
          </div>
        )}

        {/* Calendar Section */}
        <div className="mt-12">
          <h2 className="text-2xl text-center mb-6">Calendar</h2>
          <Calendar />
        </div>
      </div>
    </div>
  );
}
