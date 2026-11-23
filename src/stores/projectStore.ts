import { create } from 'zustand'
import type { Project, ProjectSettings } from '@/types'

interface ProjectState {
  projects: Project[]
  currentProject: Project | null
  addProject: (project: Project) => void
  updateProject: (project: Project) => void
  deleteProject: (id: string) => void
  setCurrentProject: (project: Project | null) => void
  updateProjectSettings: (id: string, settings: Partial<ProjectSettings>) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProject: null,
  addProject: (project) =>
    set((state) => ({
      projects: [...state.projects, project],
    })),
  updateProject: (project) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === project.id ? project : p)),
      currentProject:
        state.currentProject?.id === project.id ? project : state.currentProject,
    })),
  deleteProject: (id) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentProject: state.currentProject?.id === id ? null : state.currentProject,
    })),
  setCurrentProject: (project) =>
    set({
      currentProject: project,
    }),
  updateProjectSettings: (id, settings) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id
          ? {
              ...p,
              settings: { ...p.settings, ...settings },
              updatedAt: new Date(),
            }
          : p
      ),
    })),
}))
