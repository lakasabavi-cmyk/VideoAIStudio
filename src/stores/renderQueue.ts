import { create } from 'zustand'
import type { RenderJob } from '@/types'

interface RenderQueueState {
  jobs: RenderJob[]
  addJob: (job: RenderJob) => void
  updateJob: (job: RenderJob) => void
  removeJob: (id: string) => void
  clearCompleted: () => void
}

export const useRenderQueue = create<RenderQueueState>((set) => ({
  jobs: [],
  addJob: (job) =>
    set((state) => ({
      jobs: [...state.jobs, job],
    })),
  updateJob: (job) =>
    set((state) => ({
      jobs: state.jobs.map((j) => (j.id === job.id ? job : j)),
    })),
  removeJob: (id) =>
    set((state) => ({
      jobs: state.jobs.filter((j) => j.id !== id),
    })),
  clearCompleted: () =>
    set((state) => ({
      jobs: state.jobs.filter((j) => j.status !== 'completed'),
    })),
}))
