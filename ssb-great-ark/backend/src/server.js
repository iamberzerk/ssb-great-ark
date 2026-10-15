
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  throw new Error('DATABASE_URL dan JWT_SECRET wajib dikonfigurasi');
}

app.use(helmet());

const allowedOrigins = (process.env.WEB_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true
}));

app.use(express.json({ limit: '1mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: false }
    : undefined
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/api/health', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database_name,
        current_schema() AS schema_name
    `);

    console.log('Database identity:', result.rows[0]);

    res.json({
      ok: true,
      service: 'ssb-great-ark-api',
      database: 'connected',
      database_name: result.rows[0].database_name,
      schema_name: result.rows[0].schema_name
    });
  } catch (error) {
    console.error('Database health check failed:', error.message);

    res.status(503).json({
      ok: false,
      service: 'ssb-great-ark-api',
      database: 'unavailable'
    });
  }
});

// ==========================================
// AUTHENTICATION
// ==========================================

function auth(req, res, next) {
  const header = req.headers.authorization || '';

  try {
    if (!header.startsWith('Bearer ')) {
      throw new Error('Token tidak ditemukan');
    }

    req.user = jwt.verify(
      header.slice(7),
      process.env.JWT_SECRET
    );

    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Token tidak valid atau kedaluwarsa'
    });
  }
}

function allow(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Akses tidak diizinkan'
      });
    }

    next();
  };
}

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      error: 'Email dan password wajib diisi'
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, full_name, email, password_hash, role, is_active
       FROM users
       WHERE email = $1`,
      [String(email).toLowerCase()]
    );

    const user = result.rows[0];

    if (
      !user ||
      !user.is_active ||
      !(await bcrypt.compare(String(password), user.password_hash))
    ) {
      return res.status(401).json({
        error: 'Email atau password salah'
      });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        role: user.role,
        name: user.full_name
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Gagal masuk'
    });
  }
});

// ==========================================
// RESOURCE CONFIGURATION
// ==========================================

const resources = {
  players: {
    table: 'players',
    roles: ['admin', 'coach'],
    cols: {
      name: 'full_name',
      group: 'age_group',
      phone: 'parent_phone',
      parent: 'parent_name',
      status: 'status',
      birthdate: 'birth_date',
      notes: 'notes'
    },
    select: `id, full_name AS name, age_group AS "group",
      parent_phone AS phone, parent_name AS parent,
      status, birth_date AS birthdate, created_at`,
    required: ['name', 'group']
  },

  coaches: {
    table: 'coaches',
    roles: ['admin'],
    cols: {
      name: 'full_name',
      specialty: 'specialty',
      phone: 'phone',
      status: 'status'
    },
    select: `id, full_name AS name, specialty, phone,
      status, created_at`,
    required: ['name']
  },

  attendance: {
    table: 'attendance',
    roles: ['admin', 'coach'],
    cols: {
      player_id: 'player_id',
      name: 'player_id',
      date: 'attendance_date',
      status: 'status',
      notes: 'notes'
    },
    select: `a.id, p.full_name AS name,
      p.age_group AS "group", a.player_id,
      a.attendance_date AS date, a.status,
      a.notes, a.created_at`,
    join: ` a JOIN players p ON p.id = a.player_id`,
    required: ['player_id', 'date', 'status']
  },

  schedule: {
    table: 'training_schedules',
    roles: ['admin', 'coach'],
    cols: {
      title: 'title',
      group: 'age_group',
      date: 'starts_at',
      time: 'starts_at',
      place: 'location',
      coach: 'notes',
      notes: 'notes'
    },
    select: `id, title, age_group AS "group",
      starts_at AS date, location AS place,
      notes AS coach, created_at`,
    required: ['title', 'group', 'date', 'place']
  },

  fees: {
    table: 'fees',
    roles: ['admin'],
    cols: {
      player_id: 'player_id',
      name: 'player_id',
      group: 'period',
      amount: 'amount',
      month: 'period',
      status: 'status'
    },
    select: `f.id, f.player_id, p.full_name AS name,
      p.age_group AS "group", f.amount,
      f.period AS month, f.status, f.created_at`,
    join: ` f JOIN players p ON p.id = f.player_id`,
    required: ['player_id', 'amount', 'month']
  },

  registration: {
    table: 'registrations',
    roles: ['admin'],
    cols: {
      name: 'full_name',
      birthdate: 'birth_date',
      group: 'age_group',
      parent: 'parent_name',
      phone: 'parent_phone',
      notes: 'notes',
      status: 'status'
    },
    select: `id, full_name AS name,
      birth_date AS birthdate, age_group AS "group",
      parent_name AS parent, parent_phone AS phone,
      notes, status, created_at`,
    required: ['name', 'birthdate', 'group', 'parent', 'phone']
  },

  matches: {
    table: 'matches',
    roles: ['admin', 'coach'],
    cols: {
      title: 'title',
      type: 'kind',
      date: 'starts_at',
      place: 'location',
      group: 'age_group',
      opponent: 'opponent',
      result: 'result',
      notes: 'notes'
    },
    select: `id, title, kind AS type, starts_at AS date,
      location AS place, age_group AS "group",
      opponent, result, notes, created_at`,
    required: ['title', 'type', 'date', 'place', 'group']
  },

  development: {
    table: 'player_evaluations',
    roles: ['admin', 'coach'],
    cols: {
      player_id: 'player_id',
      name: 'player_id',
      group: 'player_id',
      tech: 'technique',
      physical: 'physical',
      discipline: 'discipline',
      mental: 'mental',
      date: 'evaluated_on',
      notes: 'notes'
    },
    select: `e.id, e.player_id, p.full_name AS name,
      p.age_group AS "group", e.technique AS tech,
      e.physical, e.discipline, e.mental,
      e.evaluated_on AS date, e.notes, e.created_at`,
    join: ` e JOIN players p ON p.id = e.player_id`,
    required: ['player_id', 'tech', 'physical', 'discipline', 'mental']
  },

  notifications: {
    table: 'notifications',
    roles: ['admin', 'coach'],
    cols: {
      title: 'title',
      message: 'message',
      date: 'scheduled_at',
      status: 'category'
    },
    select: `id, title, message, scheduled_at AS date,
      category AS status, created_at`,
    required: ['title', 'message']
  }
};

// ==========================================
// STATUS TRANSLATION
// ==========================================

const toDbStatus = {
  attendance: {
    Hadir: 'present',
    Izin: 'permission',
    Sakit: 'sick',
    Alpa: 'absent'
  },
  fees: {
    Lunas: 'paid',
    'Belum Bayar': 'unpaid',
    Tertunda: 'pending'
  },
  players: {
    Aktif: 'active',
    Nonaktif: 'inactive'
  },
  coaches: {
    Aktif: 'active',
    Nonaktif: 'inactive'
  },
  registration: {
    'Menunggu verifikasi': 'pending',
    Disetujui: 'approved',
    Ditolak: 'rejected'
  },
  matches: {
    Pertandingan: 'friendly',
    Turnamen: 'tournament'
  }
};

const toUiStatus = {
  attendance: {
    present: 'Hadir',
    permission: 'Izin',
    sick: 'Sakit',
    absent: 'Alpa'
  },
  fees: {
    paid: 'Lunas',
    unpaid: 'Belum Bayar',
    pending: 'Tertunda'
  },
  players: {
    active: 'Aktif',
    inactive: 'Nonaktif'
  },
  coaches: {
    active: 'Aktif',
    inactive: 'Nonaktif'
  },
  registration: {
    pending: 'Menunggu verifikasi',
    approved: 'Disetujui',
    rejected: 'Ditolak'
  },
  matches: {
    friendly: 'Pertandingan',
    tournament: 'Turnamen'
  }
};

function fromDb(key, row) {
  const result = { ...row };

  if (toUiStatus[key] && result.status) {
    result.status =
      toUiStatus[key][result.status] || result.status;
  }

  if (key === 'matches' && result.type) {
    result.type =
      toUiStatus.matches[result.type] || result.type;
  }

  return result;
}

function cleanInput(key, body) {
  const config = resources[key];
  const output = {};

  for (const [field, value] of Object.entries(body || {})) {
    const column = config.cols[field];

    if (!column || ['id', 'created_at'].includes(column)) {
      continue;
    }

    if (
      ['attendance', 'fees', 'development'].includes(key) &&
      ['name'].includes(field)
    ) {
      continue;
    }

    if (key === 'development' && field === 'group') {
      continue;
    }

    if (
      toDbStatus[key] &&
      typeof value === 'string'
    ) {
      output[column] = toDbStatus[key][value] || value;
    } else {
      output[column] = value;
    }

    if (
      key === 'schedule' &&
      ['date', 'time'].includes(field)
    ) {
      delete output[column];
    }
  }

  if (
    ['attendance', 'fees', 'development'].includes(key) &&
    body.player_id
  ) {
    output.player_id = body.player_id;
  }

  if (
    ['attendance', 'fees', 'development'].includes(key) &&
    body.name &&
    !body.player_id
  ) {
    return {
      __error: 'player_id wajib diisi; gunakan ID pemain dari API'
    };
  }

  if (key === 'schedule' && body.date) {
    output.starts_at =
      body.date + (body.time ? `T${body.time}:00` : 'T00:00:00');
  }

  if (key === 'development' && !output.evaluated_on) {
    output.evaluated_on = new Date().toISOString().slice(0, 10);
  }

  if (key === 'matches' && body.date) {
    output.starts_at = body.date;
  }

  if (key === 'notifications' && body.date) {
    output.scheduled_at = body.date;
  }

  return output;
}

// ==========================================
// RESOURCE ROUTES
// ==========================================

for (const [key, config] of Object.entries(resources)) {
  // GET: mengambil data
  app.get(`/api/${key}`, auth, async (req, res) => {
    if (
      !config.roles.includes(req.user.role) &&
      req.user.role !== 'parent'
    ) {
      return res.status(403).json({
        error: 'Akses tidak diizinkan'
      });
    }

    try {
      let sql =
        `SELECT ${config.select} FROM ${config.table}${config.join || ''}`;

      const params = [];

      if (req.user.role === 'parent') {
        if (key === 'players') {
          sql += ' WHERE parent_user_id = $1';
          params.push(req.user.sub);
        } else if (
          ['attendance', 'fees', 'development'].includes(key)
        ) {
          sql += ' WHERE p.parent_user_id = $1';
          params.push(req.user.sub);
        } else if (
          ['schedule', 'matches', 'notifications'].includes(key)
        ) {
          // Data ini dapat dilihat orang tua.
        } else {
          return res.json([]);
        }
      }

      sql += ' ORDER BY 1 DESC LIMIT 500';

      const result = await pool.query(sql, params);

      res.json(
        result.rows.map(row => fromDb(key, row))
      );
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'Tidak dapat mengambil data'
      });
    }
  });

  // POST: menambahkan data
  app.post(
    `/api/${key}`,
    auth,
    allow(...config.roles),
    async (req, res) => {
      try {
        const data = cleanInput(key, req.body);

        if (data.__error) {
          return res.status(400).json({
            error: data.__error
          });
        }

        const missing = config.required.filter(field =>
          req.body[field] === undefined ||
          req.body[field] === null ||
          req.body[field] === ''
        );

        if (missing.length) {
          return res.status(400).json({
            error: `Kolom wajib: ${missing.join(', ')}`
          });
        }

        const columns = Object.keys(data);

        if (!columns.length) {
          return res.status(400).json({
            error: 'Tidak ada data yang dapat disimpan'
          });
        }

        const values = columns.map(column => data[column]);

        const sql =
          `INSERT INTO ${config.table} (${columns.join(',')}) ` +
          `VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')}) ` +
          'RETURNING *';

        const result = await pool.query(sql, values);

        res.status(201).json(result.rows[0]);
      } catch (error) {
        console.error(error);

        res.status(400).json({
          error: 'Gagal menyimpan data; periksa relasi dan format kolom'
        });
      }
    }
  );

  // PUT: memperbarui data
  app.put(
    `/api/${key}/:id`,
    auth,
    allow(...config.roles),
    async (req, res) => {
      try {
        const data = cleanInput(key, req.body);

        if (data.__error) {
          return res.status(400).json({
            error: data.__error
          });
        }

        const columns = Object.keys(data);

        if (!columns.length) {
          return res.status(400).json({
            error: 'Tidak ada data yang dapat diperbarui'
          });
        }

        const values = [
          ...columns.map(column => data[column]),
          req.params.id
        ];

        const assignments = columns.map(
          (column, index) => `${column} = $${index + 1}`
        );

        const sql =
          `UPDATE ${config.table} SET ${assignments.join(',')} ` +
          `WHERE id = $${values.length} RETURNING *`;

        const result = await pool.query(sql, values);

        if (!result.rowCount) {
          return res.status(404).json({
            error: 'Data tidak ditemukan'
          });
        }

        res.json(result.rows[0]);
      } catch (error) {
        console.error(error);

        res.status(400).json({
          error: 'Gagal memperbarui data'
        });
      }
    }
  );

  // DELETE: menghapus data
  app.delete(
    `/api/${key}/:id`,
    auth,
    allow(...config.roles),
    async (req, res) => {
      try {
        const result = await pool.query(
          `DELETE FROM ${config.table} WHERE id = $1 RETURNING id`,
          [req.params.id]
        );

        if (!result.rowCount) {
          return res.status(404).json({
            error: 'Data tidak ditemukan'
          });
        }

        res.json({
          ok: true,
          id: result.rows[0].id
        });
      } catch (error) {
        console.error(error);

        res.status(400).json({
          error: 'Gagal menghapus data'
        });
      }
    }
  );
}

// ==========================================
// DASHBOARD
// ==========================================

app.get(
  '/api/dashboard',
  auth,
  allow('admin', 'coach'),
  async (_req, res) => {
    try {
      const [
        players,
        coaches,
        schedules,
        fees
      ] = await Promise.all([
        pool.query(
          "SELECT count(*)::int AS n FROM players WHERE status = 'active'"
        ),
        pool.query(
          "SELECT count(*)::int AS n FROM coaches WHERE status = 'active'"
        ),
        pool.query(
          'SELECT count(*)::int AS n FROM training_schedules WHERE starts_at >= now()'
        ),
        pool.query(
          "SELECT count(*)::int AS n FROM fees WHERE status = 'unpaid'"
        )
      ]);

      res.json({
        players: players.rows[0].n,
        coaches: coaches.rows[0].n,
        upcomingSchedules: schedules.rows[0].n,
        unpaidFees: fees.rows[0].n
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'Gagal mengambil ringkasan'
      });
    }
  }
);

// ==========================================
// ERROR HANDLER
// ==========================================

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: 'Terjadi kesalahan server'
  });
});

// ==========================================
// SERVER STARTUP
// ==========================================

const port = process.env.PORT || 4000;

// Untuk Vercel, aplikasi diekspor.
// Untuk penggunaan lokal, server dijalankan dengan app.listen().
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Great Ark API listening on ${port}`);
  });
}

module.exports = app;
