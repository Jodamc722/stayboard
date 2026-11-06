// /scoreboard → the Team scoreboard (Jon, 2026-11-06). The page lives under /training so the training
// key gates it like the rest of Training, with no new permission to set on every role.
import { redirect } from 'next/navigation'

export default function ScoreboardRedirect() {
  redirect('/training/scoreboard')
}
