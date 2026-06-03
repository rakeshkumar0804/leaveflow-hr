# Employee Leave Management System

## Live Demo

https://leaveflow-hr-hvfh.onrender.com

A full-stack employee leave management system with login, manager approval, charts, backend APIs, and a SQLite database.

## Features

- Role-based login for admin, manager, and employee users
- Employee leave request form with balance and date validation
- Manager/admin approval workflow
- Approval-time balance validation to prevent negative paid leave balances
- Dashboard metrics for pending, approved, rejected, and current-month approved leave
- Canvas charts for request status and approved leave type days
- SQLite database with seeded realistic employee and leave data
- Backend API built with Node.js and built-in SQLite

## Demo Login

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@leaveflow.test` | `admin123` |
| Manager | `manager@leaveflow.test` | `manager123` |
| Employee | `aarav@leaveflow.test` | `emp123` |

## Run Locally

```bash
npm start
```

If PowerShell blocks `npm`, run:

```bash
node backend/server.cjs
```

Open:

```text
http://localhost:3000
```

## Reset Database

```bash
node backend/server.cjs --reset-db
```

The database is created automatically at `data/leave-management.sqlite` when the server starts.
