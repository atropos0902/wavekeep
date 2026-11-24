import { bigint, boolean, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";

/** The tables people edit. Counting and locking are written as SQL next to the rule they keep. */
export const project = pgTable("project", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  currentNames: integer("current_names").notNull().default(1),
  currentDetector: integer("current_detector").notNull().default(3),
  currentQuestions: integer("current_questions").notNull().default(1),
});
export const brand = pgTable("brand", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  label: text("label").notNull(),
  isOwn: boolean("is_own").notNull().default(false),
});
export const nameSet = pgTable("name_set", {
  workspaceId: uuid("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  version: integer("version").notNull(),
  note: text("note").notNull().default(""),
});
export const nameSetName = pgTable("name_set_name", {
  workspaceId: uuid("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  version: integer("version").notNull(),
  brandId: uuid("brand_id").notNull(),
  name: text("name").notNull(),
  needsContext: boolean("needs_context").notNull().default(false),
});
export const nameSetDomain = pgTable("name_set_domain", {
  workspaceId: uuid("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  version: integer("version").notNull(),
  brandId: uuid("brand_id").notNull(),
  domain: text("domain").notNull(),
});
export const family = pgTable("family", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  label: text("label").notNull(),
});
export const question = pgTable("question", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  familyId: uuid("family_id").notNull(),
  text: text("text").notNull(),
});
export const questionSet = pgTable("question_set", {
  workspaceId: uuid("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  version: integer("version").notNull(),
  note: text("note").notNull().default(""),
});
export const questionSetItem = pgTable("question_set_item", {
  workspaceId: uuid("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  version: integer("version").notNull(),
  questionId: uuid("question_id").notNull(),
  kind: text("kind", { enum: ["core", "explore"] }).notNull(),
});
export const wave = pgTable("wave", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  seq: integer("seq").notNull(),
  questionsVersion: integer("questions_version").notNull(),
  status: text("status", { enum: ["open", "closed"] })
    .notNull()
    .default("open"),
  repeats: integer("repeats").notNull(),
  capMicros: bigint("cap_micros", { mode: "number" }).notNull(),
  planned: integer("planned"),
  done: integer("done"),
  failed: integer("failed"),
});
