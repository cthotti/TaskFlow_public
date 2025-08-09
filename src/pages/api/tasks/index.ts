import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import Task from "models/Task";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();

  if (req.method === "GET") {
    const today = new Date().toISOString().split("T")[0];
    const tasks = await Task.find({});

    const todayTasks = tasks.filter(t => !t.completed && !t.carryOver && t.date === today);
    const carryOverTasks = tasks.filter(t => !t.completed && t.carryOver);
    const completedTasks = tasks.filter(t => t.completed);

    return res.status(200).json({
      today: todayTasks,
      carryOver: carryOverTasks,
      completed: completedTasks
    });
  }

  if (req.method === "POST") {
    const { text, due } = req.body;
    const colors = [
      "#fde68a", "#bfdbfe", "#bbf7d0", "#fbcfe8", "#fcd34d",
      "#d1fae5", "#e0f2fe", "#fef9c3", "#fee2e2", "#ede9fe"
    ];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const today = new Date().toISOString().split("T")[0];

    const task = await Task.create({
      text,
      due,
      color,
      date: today,
      completed: false,
      carryOver: false
    });

    return res.status(201).json({ task });
  }

  return res.status(405).end();
}
