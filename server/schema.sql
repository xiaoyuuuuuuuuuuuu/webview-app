-- 推送 token 表。MySQL / MariaDB(cPanel 上一般是这个)。
--
-- 要点:
--   · 同一个用户可以有多台设备,所以主键是 token 而不是 user_id
--   · token 会变(重装 app、清数据、系统回收),所以要能 upsert
--   · 用户退出登录时把那条 token 的 user_id 置空或删掉,
--     不然换人登录同一台设备会收到别人的推送

CREATE TABLE IF NOT EXISTS push_tokens (
  token       VARCHAR(255) NOT NULL,
  user_id     BIGINT UNSIGNED NULL,
  platform    ENUM('ios','android') NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (token),
  KEY idx_user (user_id),
  KEY idx_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
