/** Sent on `window` with a prompt as `detail`, to put it in the home page composer. */
export const USE_PROMPT_EVENT = "appxprompt:use-prompt"

export const TEMPLATES = [
  {
    id: "recipe-planner",
    emoji: "🥗",
  },
  {
    id: "workout-tracker",
    emoji: "🏋️",
  },
  {
    id: "budget-tracker",
    emoji: "💸",
  },
  {
    id: "salon-booking",
    emoji: "💇",
  },
  {
    id: "local-events",
    emoji: "🎟️",
  },
  {
    id: "team-tasks",
    emoji: "✅",
  },
  {
    id: "language-flashcards",
    emoji: "🗣️",
  },
  {
    id: "pet-care",
    emoji: "🐶",
  },
] as const

export const QUICK_PROMPTS = [
  {
    id: "habit-tracker",
    emoji: "✅",
  },
  {
    id: "food-delivery",
    emoji: "🍜",
  },
  {
    id: "fitness-coach",
    emoji: "🏋️",
  },
  {
    id: "expense-manager",
    emoji: "💸",
  },
  {
    id: "travel-planner",
    emoji: "✈️",
  },
  {
    id: "social-feed",
    emoji: "💬",
  },
] as const
