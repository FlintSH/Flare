# PR 287 mobile interaction walkthrough

Real local Flare application at PR head 6b2ac26a02b95e95d8fea6323d137176063fc84e, with 12,000 disposable fixture uploads. Chromium emulates a 390 × 844 CSS-pixel touch viewport. This is browser emulation, not a physical phone test. No audio; no mocked server operations.

The recording shows:

1. Two-column gallery aligned with the navbar. Search narrows to Alpine images; clearing search restores all files.
2. Sort & filters opens a two-column control group. Visibility → Private adds an applied-filter chip and updates results. Collapsing controls keeps the chip visible; Reset filters restores the library.
3. Dates opens a fixed date-navigation dialog. Tapping the horizontal slider jumps to January 2020 while the dialog stays in place. Closing leaves the chosen files visible.
4. Tapping a preview opens the full-screen image viewer. Next moves to the next image; closing returns to the library at the chosen date.

The browser keyboard is not an operating-system keyboard, so an on-screen phone keyboard is not shown. Brief skeletons are the app's actual loading state.
