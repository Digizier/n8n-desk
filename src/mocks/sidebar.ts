import type { SessionMeta } from '@/types/session'
import type { AgentMeta } from '@/types/agent'

export const mockAgents: AgentMeta[] = [
  {
    id: 'agent-1',
    name: 'Invoice Bot',
    description: 'Extracts and processes invoices automatically',
    avatarColor: '#ff6d5a',
    avatarInitial: 'I',
    pinned: true,
  },
  {
    id: 'agent-2',
    name: 'Debug Helper',
    description: 'Helps debug n8n workflows step by step',
    avatarColor: '#7c3aed',
    avatarInitial: 'D',
    pinned: true,
  },
  {
    id: 'agent-3',
    name: 'Data Analyst',
    description: 'Analyzes data and creates visual reports',
    avatarColor: '#059669',
    avatarInitial: 'A',
    pinned: true,
  },
  {
    id: 'agent-4',
    name: 'Email Drafter',
    description: 'Drafts professional emails from bullet points',
    avatarColor: '#2563eb',
    avatarInitial: 'E',
    pinned: false,
  },
  {
    id: 'agent-5',
    name: 'Meeting Summarizer',
    description: 'Summarizes meeting notes and extracts action items',
    avatarColor: '#d97706',
    avatarInitial: 'M',
    pinned: false,
  },
]

export const mockChatSessions: SessionMeta[] = [
  { id: 'chat-1', title: 'Help with invoice processing', agentId: 'agent-1', agentName: 'Invoice Bot', createdAt: '2026-03-14T10:00:00Z', updatedAt: '2026-03-14T11:00:00Z', messageCount: 12 },
  { id: 'chat-2', title: 'Summarize weekly report', createdAt: '2026-03-13T09:00:00Z', updatedAt: '2026-03-13T09:30:00Z', messageCount: 6 },
  { id: 'chat-3', title: 'Debug API connection issue', agentId: 'agent-2', agentName: 'Debug Helper', createdAt: '2026-03-12T14:00:00Z', updatedAt: '2026-03-12T15:00:00Z', messageCount: 24 },
  { id: 'chat-4', title: 'Generate quarterly KPI dashboard', createdAt: '2026-03-11T08:00:00Z', updatedAt: '2026-03-11T09:00:00Z', messageCount: 18 },
  { id: 'chat-5', title: 'Draft client onboarding email', agentId: 'agent-4', agentName: 'Email Drafter', createdAt: '2026-03-10T16:00:00Z', updatedAt: '2026-03-10T17:00:00Z', messageCount: 8 },
]

export const mockCoworkSessions: SessionMeta[] = [
  { id: 'cowork-1', title: 'Process inbox PDFs', createdAt: '2026-03-14T08:00:00Z', updatedAt: '2026-03-14T09:00:00Z', messageCount: 8 },
  { id: 'cowork-2', title: 'Organize project files by date', createdAt: '2026-03-13T11:00:00Z', updatedAt: '2026-03-13T12:00:00Z', messageCount: 15 },
  { id: 'cowork-3', title: 'Extract data from CSV exports', createdAt: '2026-03-12T10:00:00Z', updatedAt: '2026-03-12T11:30:00Z', messageCount: 22 },
]

export const mockWorkflowSessions: SessionMeta[] = [
  { id: 'wf-1', title: 'Build RAG pipeline for docs', createdAt: '2026-03-14T13:00:00Z', updatedAt: '2026-03-14T14:00:00Z', messageCount: 18 },
  { id: 'wf-2', title: 'Create Slack notification flow', createdAt: '2026-03-12T16:00:00Z', updatedAt: '2026-03-12T17:00:00Z', messageCount: 10 },
  { id: 'wf-3', title: 'Automate CRM lead scoring', createdAt: '2026-03-11T14:00:00Z', updatedAt: '2026-03-11T15:30:00Z', messageCount: 14 },
]
