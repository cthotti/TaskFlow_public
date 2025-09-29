"use client";
import { useState } from "react";
import TodoList from "@/components/TodoList";
import Sidebar from "@/components/Sidebar";
import Calendar from "@/components/Calendar";
import ExtractedTasks from "@/components/ExtractedTasks";

export default function Home() {
  return (
    <div className="flex min-h-screen bg-[#0B0909] text-white">
      {/* Sidebar */}
      <Sidebar />

      {/* Divider */}
      <div className="w-[1px] bg-gray-600" />

      {/* Main content area */}
      <div className="flex-1 flex flex-col p-10">
        <h1 className="text-4xl text-center mb-6 font-bold text-[#EAEAEA]">
          TaskFlow
        </h1>

        {/* Task features */}
        <TodoList />


        {/* Calendar Section */}
        <div className="mt-12">
          <h2 className="text-2xl text-center mb-6">Calendar</h2>
          <Calendar />
        </div>

        {/* ✅ Extracted Tasks Section */}
        <div className="mt-6">
          <ExtractedTasks />
        </div>
      </div>
    </div>
  );
}
