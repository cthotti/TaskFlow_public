import { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import Task from "@/models/Task";
import clientPromise from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await clientPromise;

  const {
    query: { id },
    method,
  } = req;

  if (method === "DELETE") {
    const task = await Task.findByIdAndDelete(id);
    return res.status(200).json({ message: "Deleted", task });
  }

  return res.status(405).end();
}
