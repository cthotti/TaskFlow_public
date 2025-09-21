// pages/api/extracted/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import ExtractedTask from "@/models/ExtractedTasks";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();

  try {
    if (req.method === "GET") {
      // Return all tasks (newest first)
      const tasks = await ExtractedTask.find({}).sort({ date: -1, _id: -1 });
      return res.status(200).json(tasks);
    }

    if (req.method === "POST") {
      const { title, description, date, time, source_subject, source_from, confidence, _source_account, source_email_ts } = req.body;
      if (!title) return res.status(400).json({ error: "title required" });

      const task = await ExtractedTask.create({
        title,
        description,
        date,
        time,
        source_subject,
        source_from,
        confidence,
        _source_account,
        source_email_ts,
      });
      return res.status(201).json(task);
    }

    if (req.method === "PATCH") {
      const { id, addedToCalendar } = req.body;
      if (!id) return res.status(400).json({ error: "id required" });

      const task = await ExtractedTask.findByIdAndUpdate(id, { addedToCalendar }, { new: true });
      if (!task) return res.status(404).json({ error: "task not found" });
      return res.status(200).json(task);
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id || typeof id !== "string") {
        return res.status(400).json({ error: "id query param required" });
      }

      const deleted = await ExtractedTask.findByIdAndDelete(id);
      if (!deleted) return res.status(404).json({ error: "task not found" });
      return res.status(200).json({ message: "Deleted" });
    }

    return res.status(405).end();
  } catch (err: any) {
    console.error("Error in /api/extracted:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
}
