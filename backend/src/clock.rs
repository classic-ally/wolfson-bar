//! Injectable wall clock.
//!
//! Handlers that make time-dependent decisions (shift dates, scheduled close,
//! code freshness) read the time from `AppState::clock` instead of calling
//! `Utc::now()` directly, so tests can pin "now" to e.g. a Saturday 00:30 in BST.

use std::sync::Arc;

use chrono::{DateTime, Utc};

#[derive(Clone)]
pub struct Clock(Arc<dyn Fn() -> DateTime<Utc> + Send + Sync>);

impl Clock {
    pub fn system() -> Self {
        Clock(Arc::new(Utc::now))
    }

    #[cfg(test)]
    pub fn fixed(at: DateTime<Utc>) -> Self {
        Clock(Arc::new(move || at))
    }

    pub fn now(&self) -> DateTime<Utc> {
        (self.0)()
    }

    pub fn unix_secs(&self) -> u64 {
        self.now().timestamp().max(0) as u64
    }
}
