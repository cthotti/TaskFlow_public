"use client";
import { useState } from "react";
import TodoList from "@/components/TodoList";
import Sidebar from "@/components/Sidebar";

export default function Home() {
  const [message, setMessage] = useState("");

  const callBackend = async () => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "test" }),
    });
    const data = await res.json();
    setMessage(data.message || "No response");
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
          {message && <p className="mt-4">{message}</p>}
        </div>
      </div>
    </div>
  );
}
