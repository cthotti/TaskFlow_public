"use client";
import { useState } from "react";

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
    <div className="min-h-screen flex flex-col justify-center items-center text-white bg-black">
      <h1 className="text-4xl mb-8">Gmail Analyzer</h1>
      <button
        onClick={callBackend}
        className="bg-blue-500 hover:bg-blue-600 px-6 py-3 rounded-lg"
      >
        Analyze Emails
      </button>
      {message && <p className="mt-6 text-lg">{message}</p>}
    </div>
  );
}
