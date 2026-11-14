/** Sent on `window` with a prompt as `detail`, to put it in the home page composer. */
export const USE_PROMPT_EVENT = "appxprompt:use-prompt"

export const TEMPLATES = [
  {
    name: "Recipe planner",
    emoji: "🥗",
    category: "Food",
    description: "Find recipes by ingredient, plan the week's meals, and build a shopping list.",
    screens: ["Discover", "Recipe", "Meal plan", "Shopping list"],
    prompt:
      "A recipe and meal planning app. Screens: Discover, with a search bar, ingredient filters, and recipe cards with photo, cooking time, and calories; Recipe, with ingredients, step-by-step instructions, and a button to add it to the plan; Meal plan, a weekly calendar with breakfast, lunch, and dinner slots; and Shopping list, which collects the ingredients from the plan, grouped by aisle, with checkboxes. Fresh, warm design with rounded cards and a green accent.",
  },
  {
    name: "Workout tracker",
    emoji: "🏋️",
    category: "Health",
    description: "Log workouts, time your sets, and watch your strength go up week by week.",
    screens: ["Today", "Workout", "History", "Progress"],
    prompt:
      "A workout tracking app. Screens: Today, showing the planned workout, a streak counter, and a start button; Workout, to log sets, reps, and weight for each exercise with a rest timer between sets; History, a list of past workouts by date with total volume; and Progress, with charts of personal records and weekly volume per muscle group. Bold, energetic design with a dark background and a bright orange accent.",
  },
  {
    name: "Budget tracker",
    emoji: "💸",
    category: "Finance",
    description: "Track spending by category, set monthly budgets, and spot where money goes.",
    screens: ["Overview", "Add expense", "Budgets", "Insights"],
    prompt:
      "A personal budget app. Screens: Overview, with this month's balance, spending against budget, and recent transactions; Add expense, a quick form with amount, category icons, date, and a note; Budgets, a monthly limit for each category with a progress bar that turns red when it's close; and Insights, with a spending-by-category donut chart and a month-by-month comparison. Calm, trustworthy design with a navy and teal palette.",
  },
  {
    name: "Salon booking",
    emoji: "💇",
    category: "Business",
    description: "Let clients browse services, pick a stylist, and book a time slot.",
    screens: ["Services", "Stylists", "Book", "My bookings"],
    prompt:
      "A booking app for a hair salon. Screens: Services, a list of services with price and duration grouped by category; Stylists, with photos, specialties, and ratings; Book, where the client picks a service, a stylist, a date, and an open time slot, then confirms; and My bookings, with upcoming and past appointments and options to reschedule or cancel. Elegant, modern design with a soft rose and charcoal palette.",
  },
  {
    name: "Local events",
    emoji: "🎟️",
    category: "Social",
    description: "Discover events nearby, RSVP, and see who else is going.",
    screens: ["Explore", "Event", "My events", "Profile"],
    prompt:
      "A local events and meetups app. Screens: Explore, with event cards showing a cover image, date, place, and category chips to filter by; Event, with details, a map location, the host, attendees' avatars, and an RSVP button; My events, a list of events I'm going to and ones I've hosted; and Profile, with my interests, past events, and a short bio. Vibrant, playful design with a purple and yellow palette.",
  },
  {
    name: "Team tasks",
    emoji: "✅",
    category: "Productivity",
    description: "Organize projects into boards, assign tasks, and track what's due.",
    screens: ["Projects", "Board", "Task", "My tasks"],
    prompt:
      "A task manager for small teams. Screens: Projects, a list of projects with progress bars and member avatars; Board, a project's tasks in To do, In progress, and Done columns; Task, with title, description, assignee, due date, priority, and a checklist; and My tasks, everything assigned to me, sorted by due date with overdue tasks highlighted. Clean, minimal design with plenty of white space and a blue accent.",
  },
  {
    name: "Language flashcards",
    emoji: "🗣️",
    category: "Education",
    description: "Learn new words with flashcards, daily goals, and quick quizzes.",
    screens: ["Home", "Study", "Quiz", "Word list"],
    prompt:
      "A language learning flashcards app. Screens: Home, with today's goal, a streak, and decks to pick from; Study, a flashcard that flips to show the translation and an example sentence, with buttons for 'Again' and 'Got it'; Quiz, multiple-choice questions with a score at the end; and Word list, every word in a deck with search and a mastered badge. Friendly, encouraging design with bright colors and large, readable type.",
  },
  {
    name: "Pet care",
    emoji: "🐶",
    category: "Lifestyle",
    description: "Keep every pet's meals, vet visits, and reminders in one place.",
    screens: ["My pets", "Pet profile", "Reminders", "Health log"],
    prompt:
      "A pet care app. Screens: My pets, cards for each pet with photo, name, and the next reminder; Pet profile, with breed, age, weight, and feeding notes; Reminders, for meals, walks, medication, and vet visits, with times and repeat options; and Health log, a timeline of vet visits, vaccinations, and weight. Warm, cheerful design with soft orange and cream colors.",
  },
] as const

export const QUICK_PROMPTS = [
  {
    label: "Habit tracker",
    emoji: "✅",
    prompt:
      "A habit tracker app with daily streaks, reminders, and a weekly progress chart. Clean, calming design with soft greens.",
  },
  {
    label: "Food delivery",
    emoji: "🍜",
    prompt:
      "A food delivery app with restaurant listings, search and filters, a cart, and live order tracking on a map.",
  },
  {
    label: "Fitness coach",
    emoji: "🏋️",
    prompt:
      "A personal fitness coach app with workout plans, an exercise timer, and progress stats with charts.",
  },
  {
    label: "Expense manager",
    emoji: "💸",
    prompt:
      "An expense manager that lets users log spending by category, set monthly budgets, and see spending insights.",
  },
  {
    label: "Travel planner",
    emoji: "✈️",
    prompt:
      "A travel planner app to build day-by-day itineraries, save places, and share trips with friends.",
  },
  {
    label: "Social feed",
    emoji: "💬",
    prompt:
      "A minimal social app with a photo feed, likes, comments, user profiles, and direct messages.",
  },
] as const
