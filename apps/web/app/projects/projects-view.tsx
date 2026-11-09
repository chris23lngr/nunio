"use client";

import { createApiClient, type paths } from "@nunio/api-client";
import { useEffect, useState, type FormEvent } from "react";

type Project = paths["/api/me/projects"]["get"]["responses"][200]["content"]["application/json"][number];
type Course = paths["/api/me/review"]["get"]["responses"][200]["content"]["application/json"]["courses"][number];

/** Optional workspaces, such as exam preparation, over the student's Courses and toward at most one Obligation. */
export function ProjectsView({ apiOrigin }: { apiOrigin: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const client = createApiClient(apiOrigin);
    void (async () => {
      try {
        const [listed, review] = await Promise.all([client.GET("/api/me/projects"), client.GET("/api/me/review")]);
        if (cancelled) return;
        if (!listed.data || !review.data) return setError("Could not load your Projects.");
        setProjects(listed.data);
        setCourses(review.data.courses.filter(course => course.status === "accepted"));
      } catch { if (!cancelled) setError("Could not load your Projects."); }
    })();
    return () => { cancelled = true; };
  }, [apiOrigin, version]);

  async function act(request: () => Promise<{ response: Response }>, failure: string) {
    setBusy(true); setError(null);
    try { if (!(await request()).response.ok) throw new Error(failure); }
    catch { setError(failure); }
    finally { setBusy(false); setVersion(v => v + 1); }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    event.currentTarget.reset();
    const obligationId = String(data.get("obligation") ?? "");
    void act(() => createApiClient(apiOrigin).POST("/api/me/projects", { body: { name: String(data.get("name")),
      courseIds: data.getAll("course").map(String), obligationId: obligationId || null } }), "Could not create the Project.");
  }
  const courseName = (id: string) => courses.find(course => course.id === id)?.title ?? "A Course";
  const obligations = courses.flatMap(course => course.obligations.map(o => ({ id: o.id, title: `${o.title} (${course.title})` })));

  return (
    <section aria-labelledby="projects-title">
      <h1 id="projects-title">Projects</h1>
      <p>A Project brings together work toward an outcome, such as an exam or a thesis, across one or more Courses.</p>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={create}>
        <label>Name <input name="name" required maxLength={255} disabled={busy} /></label>
        <fieldset><legend>Courses</legend>
          {courses.map(course => <label key={course.id}><input type="checkbox" name="course" value={course.id} /> {course.title}</label>)}
        </fieldset>
        <label>Toward <select name="obligation"><option value="">No Obligation</option>
          {obligations.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}</select></label>
        <button type="submit" disabled={busy}>Create</button>
      </form>
      <ul>{projects.map(project => <li key={project.id}>
        <strong>{project.name}</strong>{project.courseIds.length > 0 && `: ${project.courseIds.map(courseName).join(", ")}`}{" "}
        <button type="button" disabled={busy} onClick={() => {
          const name = window.prompt("New name", project.name);
          if (name) void act(() => createApiClient(apiOrigin).PATCH("/api/me/projects/{id}", { params: { path: { id: project.id } }, body: { name } }),
            "Could not rename the Project.");
        }}>Rename</button>{" "}
        <button type="button" disabled={busy} onClick={() => {
          if (window.confirm(`Delete ${project.name}? Its Courses and Obligation stay.`)) void act(() =>
            createApiClient(apiOrigin).DELETE("/api/me/projects/{id}", { params: { path: { id: project.id } } }), "Could not delete the Project.");
        }}>Delete</button>
      </li>)}</ul>
    </section>
  );
}
