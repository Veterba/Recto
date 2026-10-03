# Lark plan

Lark is a small habit tracker for iPhone. This note holds the decisions; the log holds what happened.

## Platform
iOS first, built in SwiftUI. Android only after 1.0, and only if the iOS version has at least 1,000 weekly users.

## Streak rules
A streak survives one missed day: every habit gets one grace day per week. Two missed days in a row end the streak. Decided on 2026-09-09 after the first test week, because people quit when a single bad day wiped out a month.

## Notifications
At most two reminders a day, and never after 21:00 (quiet hours run 21:00–08:00). No "you broke your streak" messages: only gentle reminders before the day ends.

## Pricing
Free for everything that matters. One-time purchase of €12 unlocks themes and widgets styles. No subscriptions, no ads.

## Data
All data stays on the device (SQLite through GRDB). Export to CSV; iCloud sync maybe after 1.0.

## Release
TestFlight beta in late September, App Store release planned for 2026-10-20.
