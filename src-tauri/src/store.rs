use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::Path, time::Duration};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Task {
    pub id: String,
    pub cue: String,
    pub text: String,
    pub done: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Side {
    pub title: String,
    pub tasks: Vec<Task>,
    pub memo: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Page {
    pub date: String,
    pub left: Side,
    pub right: Side,
}

pub struct Store(Connection);

pub fn validate_date(date: &str) -> Result<(), String> {
    let bytes = date.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes
            .iter()
            .enumerate()
            .any(|(i, b)| i != 4 && i != 7 && !b.is_ascii_digit())
    {
        return Err("날짜 형식이 올바르지 않습니다.".into());
    }
    let year: u32 = date[..4].parse().map_err(|_| "잘못된 연도")?;
    let month: u32 = date[5..7].parse().map_err(|_| "잘못된 월")?;
    let day: u32 = date[8..].parse().map_err(|_| "잘못된 일")?;
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = match month {
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => 0,
    };
    if year == 0 || day == 0 || day > days {
        return Err("존재하지 않는 날짜입니다.".into());
    }
    Ok(())
}

impl Page {
    pub fn validate(&self) -> Result<(), String> {
        validate_date(&self.date)?;
        let mut ids = HashSet::new();
        for task in self.left.tasks.iter().chain(self.right.tasks.iter()) {
            if task.id.is_empty() || !ids.insert(&task.id) {
                return Err("할 일 ID가 없거나 중복되었습니다.".into());
            }
        }
        Ok(())
    }
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        let mut connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(|e| e.to_string())?;
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|e| e.to_string())?;
        match version {
            0 => {
                let transaction = connection.transaction().map_err(|e| e.to_string())?;
                transaction.execute_batch(
                    "CREATE TABLE pages (date TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
                     PRAGMA user_version = 1;"
                ).map_err(|e| e.to_string())?;
                transaction.commit().map_err(|e| e.to_string())?;
            }
            1 => (),
            _ => return Err("더 새로운 버전의 기록입니다. 최신 사각 앱으로 열어 주세요.".into()),
        }
        Ok(Self(connection))
    }

    pub fn load(&self, date: &str) -> Result<Option<Page>, String> {
        validate_date(date)?;
        let payload: Option<String> = self
            .0
            .query_row("SELECT payload FROM pages WHERE date = ?1", [date], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        payload
            .map(|json| {
                let page: Page = serde_json::from_str(&json).map_err(|e| e.to_string())?;
                page.validate()?;
                if page.date != date {
                    return Err("저장된 날짜가 일치하지 않습니다.".into());
                }
                Ok(page)
            })
            .transpose()
    }

    pub fn save(&mut self, page: &Page) -> Result<(), String> {
        page.validate()?;
        let json = serde_json::to_string(page).map_err(|e| e.to_string())?;
        if json.len() > 8 * 1024 * 1024 {
            return Err(
                "하루 기록은 8MB까지 저장할 수 있습니다. 입력 내용은 화면에 남아 있습니다.".into(),
            );
        }
        let transaction = self.0.transaction().map_err(|e| e.to_string())?;
        transaction
            .execute(
                "INSERT INTO pages (date, payload) VALUES (?1, ?2)
             ON CONFLICT(date) DO UPDATE SET payload = excluded.payload",
                params![page.date, json],
            )
            .map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example() -> Page {
        Page {
            date: "2026-11-12".into(),
            left: Side {
                title: "가상 프로젝트".into(),
                memo: "긴 한글 메모\n다음 줄\n".repeat(500),
                tasks: vec![Task {
                    id: "one".into(),
                    cue: "10:30".into(),
                    text: "가상 기록 📝".into(),
                    done: true,
                }],
            },
            right: Side {
                title: "나의 일".into(),
                memo: "개인 메모".into(),
                tasks: vec![],
            },
        }
    }

    #[test]
    fn persists_after_reopen_and_keeps_other_dates() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sagak.sqlite3");
        let mut page = example();
        {
            let mut store = Store::open(&path).unwrap();
            assert_eq!(store.load(&page.date).unwrap(), None);
            store.save(&page).unwrap();
            let mut other = page.clone();
            other.date = "2026-11-11".into();
            store.save(&other).unwrap();
            page.left.tasks[0].text = "수정된 한글\n줄바꿈".into();
            store.save(&page).unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(store.load(&page.date).unwrap(), Some(page));
        assert_eq!(
            store.load("2026-11-11").unwrap().unwrap().left.tasks[0].text,
            "가상 기록 📝"
        );
    }

    #[test]
    fn failed_write_preserves_previous_record() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sagak.sqlite3");
        let mut store = Store::open(&path).unwrap();
        let page = example();
        store.save(&page).unwrap();
        store.0.pragma_update(None, "query_only", true).unwrap();
        let mut changed = page.clone();
        changed.left.memo = "저장 실패 예시".into();
        assert!(store.save(&changed).is_err());
        assert_eq!(store.load(&page.date).unwrap(), Some(page));
    }

    #[test]
    fn refuses_newer_schema_without_resetting_it() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sagak.sqlite3");
        let mut store = Store::open(&path).unwrap();
        store.save(&example()).unwrap();
        store.0.pragma_update(None, "user_version", 2).unwrap();
        drop(store);
        assert!(Store::open(&path).is_err());
        let connection = Connection::open(&path).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM pages", [], |r| r.get::<_, u32>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn validates_dates_and_duplicate_ids() {
        for date in [
            "2026-02-29",
            "2026-11-31",
            "0000-01-01",
            "2026-00-01",
            "한글",
            "2026-1-12",
        ] {
            assert!(validate_date(date).is_err(), "{date}");
        }
        assert!(validate_date("2028-02-29").is_ok());
        let mut page = example();
        page.right.tasks = page.left.tasks.clone();
        assert!(page.validate().is_err());
    }

    #[test]
    fn damaged_record_is_an_error_instead_of_an_empty_page() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sagak.sqlite3");
        let store = Store::open(&path).unwrap();
        store
            .0
            .execute("INSERT INTO pages VALUES ('2026-11-12', 'broken')", [])
            .unwrap();
        assert!(store.load("2026-11-12").is_err());
    }
}
