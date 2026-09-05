# Runtime consumers

- TitleScreen is recreated after scene changes and shows the last completed season.
- AchievementService persists for the application session.
- SaveScheduler starts only after a save slot is loaded.
- PlatformIntegration may be disabled and recreated after reconnecting.

None of these objects is a child of CareerState or shares a stable scene owner with it.
