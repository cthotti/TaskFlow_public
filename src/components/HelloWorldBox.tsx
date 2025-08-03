"use client"; 
import { useState } from "react";

export default function HelloWorldBox() {
  const [message, setMessage] = useState("");

  async function handleClick() {
    try {
      const res = await fetch("${process.env.NEXT_PUBLIC_API_URL}/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "test" }),
      });

      const data = await res.json();
      setMessage(data.message || "No message received");
    } catch (error) {
      setMessage("Error contacting backend.");
    }
  }

  return (
    <div className="border p-6 rounded-lg bg-gray-100 dark:bg-gray-800 text-center shadow-lg">
      <button
        onClick={handleClick}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
      >
        Click Me
      </button>
      {message && <p className="mt-4 text-lg font-semibold">{message}</p>}
    </div>
  );
}