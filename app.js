const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('./db');
const app = express();

const storage = multer.diskStorage({
  destination: 'public/uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.redirect('/productos');
});


app.get('/productos', async (req, res) => {
  const resQuery = await pool.query(`
    SELECT p.*, c.nombre as categoria 
    FROM productos p 
    JOIN categorias c ON p.id_categoria = c.id_categoria
  `);
  res.render('productos', { productos: resQuery.rows });
});

app.post('/productos/create', upload.single('imagen'), async (req, res) => {
  const { nombre, precio_unitario, id_categoria } = req.body;
  const imagen = req.file ? req.file.filename : null;
  await pool.query(
    'INSERT INTO productos (nombre, precio_unitario, imagen, id_categoria) VALUES ($1, $2, $3, $4)',
    [nombre, precio_unitario, imagen, id_categoria]
  );
  res.redirect('/productos');
});



app.post('/ventas/nueva', async (req, res) => {
  const { id_producto, cantidad } = req.body;
  
  try {
    await pool.query('BEGIN');

    const prod = await pool.query('SELECT precio_unitario FROM productos WHERE id_producto = $1', [id_producto]);
    const precio = prod.rows[0].precio_unitario;

    const nuevaVenta = await pool.query('INSERT INTO ventas (total) VALUES (0) RETURNING id_venta');
    const id_venta = nuevaVenta.rows[0].id_venta;

    await pool.query(
      'INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio) VALUES ($1, $2, $3, $4)',
      [id_venta, id_producto, cantidad, precio]
    );

    await pool.query(`
      UPDATE ventas 
      SET total = (SELECT SUM(cantidad * precio) FROM detalle_venta WHERE id_venta = $1)
      WHERE id_venta = $1
    `, [id_venta]);

    await pool.query('COMMIT');
    res.redirect('/ventas');
  } catch (e) {
    await pool.query('ROLLBACK');
    res.status(500).send("Error en la transacción");
  }
});

app.listen(process.env.PORT || 3000, () => console.log('Servidor corriendo...'));