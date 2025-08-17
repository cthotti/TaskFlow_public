// src/pages/api/tasks/index.ts
import { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import Task from "@/models/Task";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();

  if (req.method === "GET") {
  try {
    const tasks = await Task.find({});
    const todayStr = new Date().toISOString().split("T")[0];

    const todayTasks = tasks.filter(
      t => !t.completed && !t.carryOver && t.date === todayStr
    );

    const carryOverTasks = tasks.filter(
      t => !t.completed && t.carryOver
    );

    const completedTasks = tasks.filter(t => t.completed);

    return res.status(200).json({
      today: todayTasks,
      carryOver: carryOverTasks,
      completed: completedTasks,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch tasks" });
  }
}

  if (req.method === "POST") {
    const { text, due, description } = req.body;
    const colors = ["#8C8C8C"];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const today = new Date().toISOString().split("T")[0];

    const task = await Task.create({
      text,
      description: description ?? "",
      due,
      color,
      date: today,
      completed: false,
      carryOver: false,
    });

    return res.status(201).json({ task });
  }

  return res.status(405).end();
}
