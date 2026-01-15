const express = require('express');
const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// MySQL 連線設定
const mysqlConfig = {
    host: '122.100.99.161',
    port: 43306,
    user: 'A999',
    password: '1023',
    database: 'fuzzy_danp'
};

const app = express();
const PORT = process.env.PORT || 3000;

// 中間件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// 確保 data 目錄存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('✅ Data directory created:', dataDir);
}

// 初始化資料庫
const db = new Database(path.join(dataDir, 'survey.db'));

// 建立資料表
db.exec(`
  CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id TEXT UNIQUE NOT NULL,
    respondent_name TEXT,
    respondent_org TEXT,
    respondent_exp TEXT,
    respondent_age TEXT,
    respondent_gender TEXT,
    device_type TEXT,
    start_time TEXT,
    end_time TEXT,
    status TEXT DEFAULT 'in_progress',
    dematel_data TEXT,
    anp_dim_data TEXT,
    anp_criteria_data TEXT,
    raw_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============ 驗證中間件 ============
const ADMIN_PASSWORD = '1102';

// 驗證管理員密碼
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: '需要管理員權限' });
  }
  next();
};

// ============ API 路由 ============

// 1. 儲存/更新問卷進度
app.post('/api/survey/save', (req, res) => {
  try {
    const data = req.body;
    const surveyId = data.surveyId;
    
    const existing = db.prepare('SELECT id FROM responses WHERE survey_id = ?').get(surveyId);
    
    if (existing) {
      // 更新
      const stmt = db.prepare(`
        UPDATE responses SET
          respondent_name = ?,
          respondent_org = ?,
          respondent_exp = ?,
          respondent_age = ?,
          respondent_gender = ?,
          device_type = ?,
          start_time = ?,
          end_time = ?,
          status = ?,
          dematel_data = ?,
          anp_dim_data = ?,
          anp_criteria_data = ?,
          raw_json = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE survey_id = ?
      `);
      
      stmt.run(
        data.respondent?.name || '',
        data.respondent?.organization || '',
        data.respondent?.experience || '',
        data.respondent?.age || '',
        data.respondent?.gender || '',
        data.deviceType || '',
        data.startTime || '',
        data.endTime || '',
        data.status || 'in_progress',
        JSON.stringify(data.dematelAnswers || {}),
        JSON.stringify(data.anpDimAnswers || []),
        JSON.stringify(data.anpCriteriaAnswers || {}),
        JSON.stringify(data),
        surveyId
      );
    } else {
      // 新增
      const stmt = db.prepare(`
        INSERT INTO responses (
          survey_id, respondent_name, respondent_org, respondent_exp,
          respondent_age, respondent_gender, device_type, start_time,
          end_time, status, dematel_data, anp_dim_data, anp_criteria_data, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        surveyId,
        data.respondent?.name || '',
        data.respondent?.organization || '',
        data.respondent?.experience || '',
        data.respondent?.age || '',
        data.respondent?.gender || '',
        data.deviceType || '',
        data.startTime || '',
        data.endTime || '',
        data.status || 'in_progress',
        JSON.stringify(data.dematelAnswers || {}),
        JSON.stringify(data.anpDimAnswers || []),
        JSON.stringify(data.anpCriteriaAnswers || {}),
        JSON.stringify(data)
      );
    }
    
    res.json({ success: true, surveyId });
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. 完成問卷
app.post('/api/survey/submit', (req, res) => {
  try {
    const data = req.body;
    data.status = 'completed';
    data.endTime = new Date().toISOString();
    
    // 使用 save 邏輯
    const surveyId = data.surveyId;
    
    const stmt = db.prepare(`
      UPDATE responses SET
        respondent_name = ?,
        respondent_org = ?,
        respondent_exp = ?,
        respondent_age = ?,
        respondent_gender = ?,
        device_type = ?,
        start_time = ?,
        end_time = ?,
        status = 'completed',
        dematel_data = ?,
        anp_dim_data = ?,
        anp_criteria_data = ?,
        raw_json = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE survey_id = ?
    `);
    
    stmt.run(
      data.respondent?.name || '',
      data.respondent?.organization || '',
      data.respondent?.experience || '',
      data.respondent?.age || '',
      data.respondent?.gender || '',
      data.deviceType || '',
      data.startTime || '',
      data.endTime || '',
      JSON.stringify(data.dematelAnswers || {}),
      JSON.stringify(data.anpDimAnswers || []),
      JSON.stringify(data.anpCriteriaAnswers || {}),
      JSON.stringify(data),
      surveyId
    );
    
    res.json({ success: true, message: '問卷已成功提交！' });
  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. 管理員登入驗證
app.post('/api/admin/login', (req, res) => {
  try {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
      res.json({ success: true, token: ADMIN_PASSWORD });
    } else {
      res.status(401).json({ success: false, error: '密碼錯誤' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. 取得所有回覆（管理後台用）
app.get('/api/admin/responses', authMiddleware, (req, res) => {
  try {
    const responses = db.prepare(`
      SELECT 
        id, survey_id, respondent_name, respondent_org, respondent_exp,
        respondent_age, respondent_gender, device_type, status,
        start_time, end_time, created_at, updated_at
      FROM responses 
      ORDER BY updated_at DESC
    `).all();
    
    res.json({ success: true, data: responses });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. 取得單一回覆完整資料
app.get('/api/admin/response/:surveyId', authMiddleware, (req, res) => {
  try {
    const response = db.prepare('SELECT * FROM responses WHERE survey_id = ?').get(req.params.surveyId);
    
    if (!response) {
      return res.status(404).json({ success: false, error: '找不到該問卷' });
    }
    
    // 解析 JSON 欄位
    response.dematel_data = JSON.parse(response.dematel_data || '{}');
    response.anp_dim_data = JSON.parse(response.anp_dim_data || '[]');
    response.anp_criteria_data = JSON.parse(response.anp_criteria_data || '{}');
    response.raw_json = JSON.parse(response.raw_json || '{}');
    
    res.json({ success: true, data: response });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. 匯出所有資料為 JSON
app.get('/api/admin/export/json', authMiddleware, (req, res) => {
  try {
    const responses = db.prepare('SELECT * FROM responses WHERE status = ?').all('completed');
    
    const exportData = responses.map(r => ({
      surveyId: r.survey_id,
      respondent: {
        name: r.respondent_name,
        organization: r.respondent_org,
        experience: r.respondent_exp,
        age: r.respondent_age,
        gender: r.respondent_gender
      },
      deviceType: r.device_type,
      startTime: r.start_time,
      endTime: r.end_time,
      dematel: JSON.parse(r.dematel_data || '{}'),
      anpDimension: JSON.parse(r.anp_dim_data || '[]'),
      anpCriteria: JSON.parse(r.anp_criteria_data || '{}')
    }));
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=fuzzy_danp_all_responses.json');
    res.json(exportData);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7. 匯出 DEMATEL 矩陣 CSV（所有人）
app.get('/api/admin/export/dematel-csv', authMiddleware, (req, res) => {
  try {
    const responses = db.prepare('SELECT survey_id, respondent_name, dematel_data FROM responses WHERE status = ?').all('completed');
    
    const criteria = ['A1','A2','A3','B1','B2','B3','C1','C2','C3','D1','D2','D3'];
    
    let csv = 'Respondent,SurveyID,From,To,Value\n';
    
    responses.forEach(r => {
      const dematel = JSON.parse(r.dematel_data || '{}');
      criteria.forEach(from => {
        criteria.forEach(to => {
          if (from !== to && dematel[from] && dematel[from][to] !== undefined) {
            csv += `"${r.respondent_name}",${r.survey_id},${from},${to},${dematel[from][to]}\n`;
          }
        });
      });
    });
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=dematel_all_responses.csv');
    res.send('\uFEFF' + csv); // BOM for Excel
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8. 匯出 ANP CSV（所有人）
app.get('/api/admin/export/anp-csv', authMiddleware, (req, res) => {
  try {
    const responses = db.prepare('SELECT survey_id, respondent_name, anp_dim_data, anp_criteria_data FROM responses WHERE status = ?').all('completed');
    
    let csv = 'Respondent,SurveyID,Type,Context,Left,Right,Value\n';
    
    const dimPairs = ['A_B','A_C','A_D','B_C','B_D','C_D'];
    
    responses.forEach(r => {
      const anpDim = JSON.parse(r.anp_dim_data || '[]');
      const anpCriteria = JSON.parse(r.anp_criteria_data || '{}');
      
      // 構面比較
      dimPairs.forEach((pair, i) => {
        const [left, right] = pair.split('_');
        csv += `"${r.respondent_name}",${r.survey_id},Dimension,-,${left},${right},${anpDim[i] || 5}\n`;
      });
      
      // 指標比較
      Object.entries(anpCriteria).forEach(([context, values]) => {
        const targetDim = context.split('_')[1];
        const criteriaMap = { A: ['A1','A2','A3'], B: ['B1','B2','B3'], C: ['C1','C2','C3'], D: ['D1','D2','D3'] };
        const cs = criteriaMap[targetDim];
        const pairs = [[cs[0],cs[1]], [cs[0],cs[2]], [cs[1],cs[2]]];
        
        pairs.forEach((pair, i) => {
          csv += `"${r.respondent_name}",${r.survey_id},Criteria,${context},${pair[0]},${pair[1]},${values[i] || 5}\n`;
        });
      });
    });
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=anp_all_responses.csv');
    res.send('\uFEFF' + csv);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 9. 刪除回覆
app.delete('/api/admin/response/:surveyId', authMiddleware, (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM responses WHERE survey_id = ?');
    stmt.run(req.params.surveyId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 10. 統計資訊
app.get('/api/admin/stats', authMiddleware, (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM responses').get().count;
    const completed = db.prepare('SELECT COUNT(*) as count FROM responses WHERE status = ?').get('completed').count;
    const inProgress = db.prepare('SELECT COUNT(*) as count FROM responses WHERE status = ?').get('in_progress').count;
    
    res.json({
      success: true,
      data: { total, completed, inProgress }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 11. 詳細統計分析資料
app.get('/api/admin/analytics', authMiddleware, (req, res) => {
  try {
    // 基本統計
    const total = db.prepare('SELECT COUNT(*) as count FROM responses').get().count;
    const completed = db.prepare('SELECT COUNT(*) as count FROM responses WHERE status = ?').get('completed').count;
    const inProgress = db.prepare('SELECT COUNT(*) as count FROM responses WHERE status = ?').get('in_progress').count;

    // 每日填寫統計
    const dailyStats = db.prepare(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count
      FROM responses 
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `).all();

    // 填寫時間分析 (已完成的問卷)
    const timeAnalysis = db.prepare(`
      SELECT 
        start_time,
        end_time,
        (julianday(end_time) - julianday(start_time)) * 24 * 60 as duration_minutes
      FROM responses 
      WHERE status = 'completed' 
        AND start_time IS NOT NULL 
        AND end_time IS NOT NULL
      ORDER BY created_at DESC
    `).all();

    // 設備類型統計
    const deviceStats = db.prepare(`
      SELECT 
        device_type,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count
      FROM responses 
      WHERE device_type IS NOT NULL
      GROUP BY device_type
    `).all();

    // 機構統計
    const orgStats = db.prepare(`
      SELECT 
        respondent_org,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count
      FROM responses 
      WHERE respondent_org IS NOT NULL AND respondent_org != ''
      GROUP BY respondent_org
      ORDER BY count DESC
      LIMIT 20
    `).all();

    // 經驗分布統計
    const expStats = db.prepare(`
      SELECT 
        respondent_exp,
        COUNT(*) as count
      FROM responses 
      WHERE respondent_exp IS NOT NULL AND respondent_exp != ''
      GROUP BY respondent_exp
      ORDER BY count DESC
    `).all();

    // 年齡分布統計
    const ageStats = db.prepare(`
      SELECT 
        respondent_age,
        COUNT(*) as count
      FROM responses 
      WHERE respondent_age IS NOT NULL AND respondent_age != ''
      GROUP BY respondent_age
      ORDER BY count DESC
    `).all();

    // 計算平均填寫時間
    const avgDuration = timeAnalysis.length > 0 
      ? timeAnalysis.reduce((sum, item) => sum + (item.duration_minutes || 0), 0) / timeAnalysis.length
      : 0;

    res.json({
      success: true,
      data: {
        summary: { total, completed, inProgress, avgDuration: Math.round(avgDuration * 100) / 100 },
        dailyStats,
        timeAnalysis,
        deviceStats,
        orgStats,
        expStats,
        ageStats
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 12. 資料遷移到 MySQL
app.post('/api/admin/migrate-to-mysql', authMiddleware, async (req, res) => {
  let connection;
  try {
    // 連接 MySQL
    connection = await mysql.createConnection(mysqlConfig);

    // 建立資料表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS responses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        survey_id VARCHAR(255) UNIQUE NOT NULL,
        respondent_name VARCHAR(255),
        respondent_org VARCHAR(255),
        respondent_exp VARCHAR(255),
        respondent_age VARCHAR(255),
        respondent_gender VARCHAR(255),
        device_type VARCHAR(255),
        start_time VARCHAR(255),
        end_time VARCHAR(255),
        status VARCHAR(50) DEFAULT 'in_progress',
        dematel_data LONGTEXT,
        anp_dim_data LONGTEXT,
        anp_criteria_data LONGTEXT,
        raw_json LONGTEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // 從 SQLite 讀取所有資料
    const sqliteData = db.prepare('SELECT * FROM responses').all();

    let inserted = 0;
    let skipped = 0;

    // 逐筆插入 MySQL
    for (const row of sqliteData) {
      try {
        await connection.execute(`
          INSERT IGNORE INTO responses
          (survey_id, respondent_name, respondent_org, respondent_exp,
           respondent_age, respondent_gender, device_type, start_time,
           end_time, status, dematel_data, anp_dim_data, anp_criteria_data,
           raw_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          row.survey_id,
          row.respondent_name,
          row.respondent_org,
          row.respondent_exp,
          row.respondent_age,
          row.respondent_gender,
          row.device_type,
          row.start_time,
          row.end_time,
          row.status,
          row.dematel_data,
          row.anp_dim_data,
          row.anp_criteria_data,
          row.raw_json,
          row.created_at,
          row.updated_at
        ]);

        // 檢查是否真的有插入
        if (connection.affectedRows > 0) {
          inserted++;
        } else {
          skipped++;
        }
      } catch (insertErr) {
        skipped++;
      }
    }

    await connection.end();

    res.json({
      success: true,
      message: '資料遷移完成',
      data: {
        total: sqliteData.length,
        inserted,
        skipped
      }
    });
  } catch (error) {
    console.error('Migration error:', error);
    if (connection) {
      try { await connection.end(); } catch (e) {}
    }
    res.status(500).json({
      success: false,
      error: '遷移失敗: ' + error.message
    });
  }
});

// 首頁導向問卷
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'survey.html'));
});

// 管理員登入頁面
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 管理後台
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║         Fuzzy DANP 專家問卷系統已啟動！                    ║
╠════════════════════════════════════════════════════════════╣
║  問卷網址：http://localhost:${PORT}                          ║
║  管理後台：http://localhost:${PORT}/admin                    ║
╚════════════════════════════════════════════════════════════╝
  `);
});
