import mongoose, { Schema, model, models } from "mongoose";

export interface ExtractedTask {
  _id?: string;
  title: string;
  description?: string;
  date?: string;
  time?: string;
  source_subject?: string;
  source_from?: string;
  confidence?: number;
  addedToCalendar?: boolean;
}

const ExtractedTaskSchema = new Schema<ExtractedTask>({
  title: { type: String, required: true },
  description: { type: String },
  date: { type: String },
  time: { type: String },
  source_subject: { type: String },
  source_from: { type: String },
  confidence: { type: Number },
  addedToCalendar: { type: Boolean, default: false },
});

export default models.ExtractedTask || model<ExtractedTask>("ExtractedTask", ExtractedTaskSchema);
