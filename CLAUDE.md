# SmallBiz Lens — Development Instructions

## Project

SmallBiz Lens is a small-business inventory, sales, purchase, and expense management application.

The current goal is to build a reliable V1 product before adding advanced AI features or advanced AI-augmented software development workflows.

---

# Current Development Phase

We are currently building the V1 frontend UI prototype.

Focus on:

* Dashboard
* Product management
* Inventory
* Purchase/restocking inside Inventory
* Sales
* Expenses
* Basic business calculations
* Clean and responsive UI

Do NOT implement the following yet:

* AI chatbot
* AI-generated recommendations
* Machine-learning forecasting
* Advanced predictive analytics
* MCP
* Hooks
* Subagents
* Advanced AI-augmented development infrastructure

These will be considered only after the core product is working.

---

# Application Structure

The V1 application has four main pages:

1. Dashboard
2. Inventory
3. Sales
4. Expenses

There is currently no separate Purchases page.

Purchases/restocking should be implemented inside Inventory.

However, keep the code organized so that purchase functionality can be separated into its own page later if future requirements justify it.

Do not create a separate Purchases page unless explicitly requested.

---

# Source of Truth

`SPEC.md` is the primary source of truth for product requirements.

Always read `SPEC.md` before making significant product changes.

Do not invent new product requirements.

Do not add unnecessary pages or features.

If a requirement conflicts with `SPEC.md`, identify the conflict before making a major change.

---

# Important Business Rules

Business calculations must be deterministic and explainable.

Examples:

```text
Current Stock = Opening Stock + Purchased Quantity - Sold Quantity

Low Stock = Current Stock <= Minimum Stock Level

Revenue = Total Recorded Sales

Estimated Profit = Revenue - Expenses
```

Do not use AI to calculate or invent business facts.

AI should eventually explain verified business calculations rather than replace them.

---

# UI Principles

The application should be:

* Clean
* Modern
* Professional
* Simple
* Responsive
* Easy for a small-business owner to understand

The application should feel like a real business product.

Avoid:

* Excessive gradients
* Excessive glassmorphism
* Neon colors
* Futuristic AI styling
* Unnecessary animations
* Decorative elements that reduce usability
* Unnecessary pages
* Unnecessary complexity

Do not make the application look like an AI research dashboard.

---

# Mock Data

During UI prototyping, use realistic mock data.

Mock data should include:

* Products
* Sales
* Purchases
* Expenses

Use a consistent fictional retail business.

Keep mock data centralized and easy to replace with API/database data later.

Do not use random meaningless numbers.

---

# Development Principles

1. Read `SPEC.md` and this file before making significant changes.

2. Inspect the existing project before modifying it.

3. Preserve useful existing work.

4. Do not introduce unnecessary technologies.

5. Prefer simple, maintainable code.

6. Use reusable components where they provide clear value.

7. Do not over-engineer the application.

8. Keep business logic separate from presentation where practical.

9. Test important functionality after implementation.

10. Do not make destructive changes without approval.

11. Do not add major features without explicit approval.

12. If an important architectural decision is unclear, ask before proceeding.

---

# Current Technical Direction

Preferred frontend stack:

* React
* TypeScript
* Tailwind CSS
* Recharts or another lightweight charting library

The exact stack should first be checked against the existing project before installing or replacing dependencies.

Backend and database will be introduced later.

Potential later direction:

* Node.js
* Express
* TypeScript
* PostgreSQL

Do not implement the backend or database during the initial UI prototype unless explicitly requested.

---

# Development Order

The project should be developed incrementally:

1. UI prototype
2. UI review and refinement
3. Backend
4. Database
5. API integration
6. Business calculations
7. Testing
8. Advanced analytics
9. Forecasting
10. Recommendations
11. AI explanations
12. AI assistant
13. AI-augmented software development workflow

Do not skip directly to advanced AI features.

---

# Future Architecture

The product may eventually include:

* Advanced analytics
* Demand forecasting
* Restocking recommendations
* AI-generated explanations
* AI business assistant
* Skills
* Commands
* Hooks
* Subagents
* MCP
* Automated verification

These are future capabilities and should not be implemented during the initial V1 UI prototype.

---

# Change Management

Before making a major change:

1. Check `SPEC.md`.
2. Check the current project structure.
3. Determine whether the change belongs to V1.
4. Avoid unnecessary scope expansion.
5. Explain the change before implementing it if it significantly affects architecture or product behavior.

The goal is to build a working product first and add complexity only when it is useful.
