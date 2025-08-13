// src/pages/api/tasks/index.ts
import { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import Task from "@/models/Task";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();

  if (req.method === "GET") {
    try {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);

      // Format dates for comparison
      const formatDate = (d: Date) => d.toISOString().split("T")[0];

      // Fetch today's tasks
      const todayTasks = await Task.find({ date: formatDate(today) });

      // Fetch yesterday's tasks that are not completed
      const carryOverTasks = await Task.find({
        date: formatDate(yesterday),
        completed: false,
      });

      // Fetch completed tasks (from today and yesterday)
      const completedTasks = await Task.find({
        completed: true,
        date: { $in: [formatDate(today), formatDate(yesterday)] },
      });

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
    const colors = ["#fef3c7", "#dbeafe", "#dcfce7", "#fde2e2", "#fbcfe8"];
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
