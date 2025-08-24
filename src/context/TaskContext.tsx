"use client";
import { createContext, useContext, useState, ReactNode } from "react";

type TaskContextType = {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
};

const TaskContext = createContext<TaskContextType | undefined>(undefined);

export const TaskProvider = ({ children }: { children: ReactNode }) => {
  const todayStr = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);

  return (
    <TaskContext.Provider value={{ selectedDate, setSelectedDate }}>
      {children}
    </TaskContext.Provider>
  );
};

export const useTaskContext = () => {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error("useTaskContext must be inside TaskProvider");
  return ctx;
};
