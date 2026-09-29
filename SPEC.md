# SmallBiz Lens — V1 Specification

## 1. Project Overview

SmallBiz Lens is a small-business inventory, sales, purchase, and expense management application designed for small retail businesses.

The goal of V1 is to allow a shopkeeper to record everyday business information and view useful summaries of their business.

V1 focuses on:

* Reliable data management
* Inventory management
* Sales recording
* Purchase/restocking recording
* Expense tracking
* Basic business summaries
* A clean and simple user experience

AI, machine-learning forecasting, advanced recommendations, and AI-assisted development infrastructure are intentionally outside the scope of V1.

---

## 2. Target User

The primary user is a small retail shop owner or shopkeeper who needs a simple way to manage:

* Products
* Inventory
* Sales
* Purchases/restocking
* Expenses

The application should be simple enough for a non-technical business owner to understand and use.

---

## 3. V1 Application Structure

The V1 application has four main pages:

1. Dashboard
2. Inventory
3. Sales
4. Expenses

There is no separate Purchases page in V1.

Purchases and restocking are handled inside the Inventory section because purchasing directly affects inventory stock.

The application should be structured so that a separate Purchases page can be introduced later if the product requirements grow.

---

# 4. Dashboard

The Dashboard should provide a quick overview of the business.

### Main statistics

Display:

* Today's Sales
* Total Sales
* Total Expenses
* Estimated Profit
* Total Products
* Low-Stock Products

### Additional information

Include:

* Sales trend chart
* Top-selling products
* Low-stock product summary
* Recent sales or recent activity

The purpose of the Dashboard is to allow a shopkeeper to understand the current state of the business quickly without inspecting individual records.

---

# 5. Inventory

The Inventory page manages products, stock levels, and purchase/restocking activity.

## Product Management

Include:

* Product table
* Product name
* Category
* Current stock
* Selling price
* Purchase price
* Minimum stock level
* Stock status

Stock statuses:

* Healthy
* Low Stock
* Out of Stock

Allow the user to:

* Add Product
* Edit Product
* Delete Product

---

## Purchase / Restocking

Purchases should be managed within the Inventory section in V1.

The purchase/restocking functionality should allow the user to record:

* Product
* Quantity purchased
* Purchase price
* Date
* Supplier (optional)

Include:

* Record Purchase / Restock form
* Purchase history

Purchase history should display information such as:

* Product
* Quantity
* Purchase price
* Date
* Supplier

For the initial UI prototype, these actions can use mock/local state.

---

# 6. Sales

The Sales page allows the user to record and review sales.

## Record Sale

Include:

* Product selection
* Quantity
* Selling price
* Date

## Sales History

Include:

* Product
* Quantity
* Total amount
* Date

Recording a sale should conceptually decrease the available stock.

For the initial UI prototype, the form does not need to persist data to a database.

---

# 7. Expenses

The Expenses page allows the user to record and review business expenses.

## Record Expense

Include:

* Expense category
* Amount
* Date
* Description

## Expense History

Include:

* Category
* Amount
* Date
* Description

---

# 8. Core Business Rules

The application should use deterministic and explainable calculations.

### Current Stock

```text
Current Stock = Opening Stock + Purchased Quantity - Sold Quantity
```

### Low Stock

```text
Low Stock = Current Stock <= Minimum Stock Level
```

### Revenue

```text
Revenue = Total Recorded Sales
```

### Estimated Profit

```text
Estimated Profit = Revenue - Expenses
```

The V1 profit figure should be clearly labeled as an estimate.

These calculations should not depend on an AI model.

---

# 9. V1 UI Requirements

The interface should be:

* Clean
* Modern
* Professional
* Simple
* Easy to understand
* Responsive
* Suitable for a small retail business
* Consistent across all pages

The design should prioritize useful information over decoration.

The application should feel like a real business product rather than a generic student CRUD application.

Avoid:

* Excessive gradients
* Excessive glassmorphism
* Neon colors
* Futuristic AI visuals
* Unnecessary animations
* Unnecessary pages
* Decorative elements that reduce usability

The application should not look like an AI research dashboard.

---

# 10. Mock Data

During the UI prototype stage, use realistic mock data for:

* Products
* Sales
* Purchases
* Expenses

Use a consistent fictional small retail business.

Mock data should be internally sensible.

For example, products may include:

* Biscuits
* Milk
* Bread
* Rice
* Cooking Oil
* Eggs

Keep mock data centralized so that it can later be replaced by API/database data.

---

# 11. V1 Scope

### Included

* Dashboard
* Product management
* Inventory management
* Purchase/restocking recording
* Sales recording
* Sales history
* Expense recording
* Expense history
* Basic business calculations
* Responsive UI
* Mock data during prototype development

### Not Included in V1

* AI chatbot
* AI-generated business recommendations
* Machine-learning demand forecasting
* Advanced predictive analytics
* External accounting integrations
* Supplier integrations
* Payment gateway
* Multi-store management
* Multi-user authentication
* MCP
* Hooks
* Subagents
* Advanced AI-augmented development workflows

---

# 12. Future Direction

After V1 is working reliably, the project may be expanded with:

1. Advanced sales analytics
2. Fast/slow product analysis
3. Stock-duration estimation
4. Restocking recommendations
5. Demand forecasting
6. AI-generated business explanations
7. AI business assistant
8. Additional purchase management functionality
9. A dedicated Purchases page if future requirements justify it
10. AI-augmented software development workflows using Skills, Commands, Hooks, Subagents, MCP, and verification systems

Future features should only be added when they provide a clear purpose and should not unnecessarily complicate the core product.
