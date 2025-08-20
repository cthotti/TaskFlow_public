"use client";
import { useState } from "react";
import TodoList from "@/components/TodoList";

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
    <div className="min-h-screen p-10 bg-[#0B0909]-900 text-white">
      <h1 className="text-4xl text-center mb-6 font-bold text-[#DED9D3]-400">Cal∀Stdnts</h1>
      <TodoList />
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
  );
}
