"use client";

import { Button } from "@nunio/ui/components/button/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nunio/ui/components/select/select";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import type { FormEvent } from "react";
import { useState } from "react";

export type TaskItem = {
  id: string;
  title: string;
  course: string | null;
  /** When it is due: its window's end, or its Obligation's deadline. */
  due: Date | null;
};
const noCourse = "none";

/** The student's open Tasks, and adding one in a Course or with none. */
export function TaskList({
  tasks,
  courses,
  onComplete,
  onAdd,
}: {
  tasks: TaskItem[];
  courses: { id: string; title: string }[];
  onComplete: (id: string) => void;
  onAdd: (task: { title: string; courseId: string | null }) => void;
}) {
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState(noCourse);
  const items = [
    { value: noCourse, label: "Kein Kurs" },
    ...courses.map((c) => ({ value: c.id, label: c.title })),
  ];
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onAdd({
      title: title.trim(),
      courseId: course === noCourse ? null : course,
    });
    setTitle("");
  };
  return (
    <section
      aria-labelledby="tasks-title"
      className="flex w-full flex-col gap-3"
    >
      <h2 id="tasks-title" className="text-base font-medium text-base-800">
        Aufgaben
      </h2>
      {tasks.length === 0 ? (
        <p className="text-sm text-base-500">Keine offenen Aufgaben.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                aria-label={`${task.title} erledigt`}
                onChange={() => onComplete(task.id)}
              />
              <span className="min-w-0 flex-1 truncate text-base-800">
                {task.title}
              </span>
              {task.course && (
                <span className="shrink-0 text-base-500">{task.course}</span>
              )}
              {task.due && (
                <span className="shrink-0 text-base-500">
                  bis {format(task.due, "EEE dd.MM., HH:mm", { locale: de })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Neue Aufgabe"
          placeholder="Neue Aufgabe"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="min-w-48 flex-1 rounded-md border border-base-200 px-2 py-1 text-sm"
        />
        <Select
          value={course}
          onValueChange={(value) => setCourse(value ?? noCourse)}
          items={items}
        >
          <SelectTrigger aria-label="Kurs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            align="start"
            sideOffset={8}
            alignItemWithTrigger={false}
          >
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline" size="sm">
          Hinzufügen
        </Button>
      </form>
    </section>
  );
}
