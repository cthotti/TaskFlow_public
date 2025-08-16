// src/pages/api/tasks/index.ts
import { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import Task from "@/models/Task";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();

  if (req.method === "GET") {
    try {
      const tasks = await Task.find({});
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);

      // Format dates for comparison
      const formatDate = (d: Date) => d.toISOString().split("T")[0];

      // Fetch today's tasks
      const todayTasks = tasks.filter(t => !t.completed && !t.carryOver && t.date === today);

      // Fetch yesterday's tasks that are not completed
      const carryOverTasks = tasks.filter(t => !t.completed && t.carryOver);

      // Fetch completed tasks (from today and yesterday)
      const completedTasks = tasks.filter(t => t.completed);

      return res.status(200).json({
        todayTasks,
        carryOverTasks,
        completedTasks,
      });
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch tasks" });
    }
  }

  if (req.method === "POST") {
    const { text, due, description } = req.body;
    const colors = ["#a3a3a3ff"];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const today = new Date().toISOString().split("T")[0];

    const task = await Task.create({
      text,
      description: description ?? "",
      due,
      color,
      date: today,
      completed: false,
    });

    return res.status(201).json({ task });
  }

  return res.status(405).end();
}
