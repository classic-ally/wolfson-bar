// Shift configuration constants
pub const DEFAULT_SHIFT_MAX_VOLUNTEERS: i32 = 2;
pub const DEFAULT_SHIFT_REQUIRES_CONTRACT: bool = false;

/// Timezone the bar's opening hours and shift dates are expressed in.
/// Used instead of the host's local time, which is UTC on the production server.
pub const BAR_TZ: chrono_tz::Tz = chrono_tz::Europe::London;
