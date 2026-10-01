//! Serving the built frontend with cache headers that survive redeploys.
//!
//! Files in the Nix store all carry an mtime of 1970-01-01, so `ServeDir`'s
//! `Last-Modified` never changes between deploys. Left alone, browsers cache
//! `index.html` heuristically for years and every `If-Modified-Since`
//! revalidation answers 304, so an old page keeps requesting hashed bundles
//! that no longer exist and renders nothing. Hashed assets are therefore
//! cached forever, while everything else is always fetched fresh.

use std::path::Path;

use axum::extract::Request;
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::Router;
use tower_http::services::{ServeDir, ServeFile};

const IMMUTABLE: HeaderValue = HeaderValue::from_static("public, max-age=31536000, immutable");
const NO_CACHE: HeaderValue = HeaderValue::from_static("no-cache");

/// Router serving `dist`: `/assets/*` strictly (a missing bundle is a 404,
/// never HTML), and everything else with an `index.html` fallback for
/// client-side routes.
pub fn frontend(dist: &Path) -> Router {
    // `fallback` rather than `not_found_service`: the latter rewrites the
    // status to 404, which client routes like `/events` are not.
    let spa = ServeDir::new(dist).fallback(ServeFile::new(dist.join("index.html")));
    Router::new()
        .nest_service("/assets", ServeDir::new(dist.join("assets")))
        .fallback_service(spa)
        .layer(middleware::from_fn(cache_headers))
}

async fn cache_headers(mut req: Request, next: Next) -> Response {
    if req.uri().path().starts_with("/assets/") {
        let mut res = next.run(req).await;
        if res.status() == StatusCode::OK {
            res.headers_mut().insert(header::CACHE_CONTROL, IMMUTABLE);
        }
        return res;
    }

    // The mtime is meaningless, so neither honour nor hand out validators
    // based on it; a browser holding a 1970-dated copy must get a full 200.
    let headers = req.headers_mut();
    headers.remove(header::IF_MODIFIED_SINCE);
    headers.remove(header::IF_NONE_MATCH);

    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    headers.remove(header::LAST_MODIFIED);
    headers.insert(header::CACHE_CONTROL, NO_CACHE);
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use std::path::PathBuf;
    use tower::ServiceExt;

    const INDEX: &str = "<!doctype html><script src=\"/assets/app-abc.js\"></script>";

    /// Throwaway dist directory, removed on drop.
    struct Dist(PathBuf);

    impl Dist {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("wolfson-dist-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(dir.join("assets")).unwrap();
            std::fs::write(dir.join("index.html"), INDEX).unwrap();
            std::fs::write(dir.join("assets/app-abc.js"), "console.log(1)").unwrap();
            Self(dir)
        }
    }

    impl Drop for Dist {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    async fn get(dist: &Dist, path: &str, if_modified_since: Option<&str>) -> Response {
        let mut req = Request::get(path);
        if let Some(date) = if_modified_since {
            req = req.header(header::IF_MODIFIED_SINCE, date);
        }
        frontend(&dist.0).oneshot(req.body(Body::empty()).unwrap()).await.unwrap()
    }

    async fn body(res: Response) -> String {
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    fn header_str<'a>(res: &'a Response, name: header::HeaderName) -> Option<&'a str> {
        res.headers().get(name).map(|v| v.to_str().unwrap())
    }

    // Should: serve the app shell for client-side routes.
    // Should: tell the browser to revalidate the shell on every visit.
    // Should not: send a Last-Modified derived from the file's mtime.
    #[tokio::test]
    async fn client_route_serves_uncached_index() {
        let dist = Dist::new();
        let res = get(&dist, "/events", None).await;

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(header_str(&res, header::CACHE_CONTROL), Some("no-cache"));
        assert!(res.headers().get(header::LAST_MODIFIED).is_none());
        assert_eq!(body(res).await, INDEX);
    }

    // Impact: regression guard; Nix store mtimes never change, so browsers holding
    // an old page kept getting 304s after a redeploy and rendered a white screen.
    // Should: return the current page even when the browser claims an up-to-date copy.
    #[tokio::test]
    async fn conditional_request_for_index_gets_full_response() {
        let dist = Dist::new();
        let res = get(&dist, "/", Some("Thu, 01 Jan 1970 00:00:01 GMT")).await;

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body(res).await, INDEX);
    }

    // Should: let browsers cache content-hashed bundles indefinitely.
    #[tokio::test]
    async fn hashed_asset_is_immutable() {
        let dist = Dist::new();
        let res = get(&dist, "/assets/app-abc.js", None).await;

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            header_str(&res, header::CACHE_CONTROL),
            Some("public, max-age=31536000, immutable")
        );
        assert!(header_str(&res, header::CONTENT_TYPE).unwrap().contains("javascript"));
    }

    // Impact: falling back to index.html here made the browser reject the bundle on
    // MIME type, hiding the real problem (a stale page) behind a blank screen.
    // Should: report a bundle from a previous deploy as not found.
    // Should not: mark the not-found response as cacheable forever.
    #[tokio::test]
    async fn missing_asset_is_not_found_not_html() {
        let dist = Dist::new();
        let res = get(&dist, "/assets/app-OLD.js", None).await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        assert!(res.headers().get(header::CACHE_CONTROL).is_none());
        assert_ne!(body(res).await, INDEX);
    }
}
