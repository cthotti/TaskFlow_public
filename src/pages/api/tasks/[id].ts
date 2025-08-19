import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import Task from "models/Task";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();
  const { id } = req.query;

  if (req.method === "DELETE") {
    await Task.findByIdAndDelete(id);
    return res.status(200).json({ message: "Task deleted" });
  }

  if (req.method === "PATCH") {
    const { completed, carryOver } = req.body;
    const updateData: any = {};

    if (completed !== undefined) updateData.completed = completed;

    if (carryOver !== undefined) {
      updateData.carryOver = carryOver;

      // if moving back to today, reset the date field to today
      if (carryOver === false) {
        const todayStr = new Date().toISOString().split("T")[0];
        updateData.date = todayStr;
      }
    }

    const updated = await Task.findByIdAndUpdate(id, updateData, { new: true });
    return res.status(200).json({ task: updated });
  }

  return res.status(405).end();
}
