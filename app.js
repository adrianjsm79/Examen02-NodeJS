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
    res.redirect('/ventas');
});

app.get('/productos', async (req, res) => {
  const productosQuery = await pool.query(`
    SELECT p.*, c.nombre as categoria 
    FROM productos p 
    JOIN categorias c ON p.id_categoria = c.id_categoria
  `);
  const categoriasQuery = await pool.query('SELECT id_categoria, nombre FROM categorias ORDER BY nombre');

  res.render('productos', {
    productos: productosQuery.rows,
    categorias: categoriasQuery.rows
  });
});

app.post('/productos/create', upload.single('imagen'), async (req, res) => {
  const { nombre, precio_unitario, id_categoria } = req.body;
  const imagen = req.file ? req.file.filename : null;

  const categoriaExists = await pool.query(
    'SELECT 1 FROM categorias WHERE id_categoria = $1',
    [id_categoria]
  );

  if (categoriaExists.rowCount === 0) {
    return res.status(400).send('Categoría inválida. Por favor selecciona una categoría válida.');
  }

  await pool.query(
    'INSERT INTO productos (nombre, precio_unitario, imagen, id_categoria) VALUES ($1, $2, $3, $4)',
    [nombre, precio_unitario, imagen, id_categoria]
  );
  res.redirect('/productos');
});

async function actualizarTotalVenta(id_venta) {
  await pool.query(
    'UPDATE ventas SET total = COALESCE((SELECT SUM(cantidad * precio) FROM detalle_venta WHERE id_venta = $1), 0) WHERE id_venta = $1',
    [id_venta]
  );
}

app.get('/ventas', async (req, res) => {
  const ventasQuery = await pool.query(`
    SELECT v.*, COALESCE(SUM(d.cantidad), 0) AS total_items, COALESCE(COUNT(d.id_detalle), 0) AS detalles_count
    FROM ventas v
    LEFT JOIN detalle_venta d ON v.id_venta = d.id_venta
    GROUP BY v.id_venta
    ORDER BY v.fecha DESC
  `);
  const productosQuery = await pool.query('SELECT id_producto, nombre, precio_unitario FROM productos ORDER BY nombre');

  res.render('ventas', {
    ventas: ventasQuery.rows,
    productos: productosQuery.rows
  });
});

app.post('/ventas/create', async (req, res) => {
  const { id_producto, cantidad } = req.body;

  if (!id_producto || !cantidad || Number(cantidad) <= 0) {
    return res.status(400).send('Producto y cantidad válidos son obligatorios.');
  }

  try {
    await pool.query('BEGIN');

    const prod = await pool.query('SELECT precio_unitario FROM productos WHERE id_producto = $1', [id_producto]);
    if (prod.rowCount === 0) {
      await pool.query('ROLLBACK');
      return res.status(400).send('Producto no encontrado.');
    }

    const precio = prod.rows[0].precio_unitario;
    const nuevaVenta = await pool.query('INSERT INTO ventas (total) VALUES (0) RETURNING id_venta');
    const id_venta = nuevaVenta.rows[0].id_venta;

    await pool.query(
      'INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio) VALUES ($1, $2, $3, $4)',
      [id_venta, id_producto, cantidad, precio]
    );

    await actualizarTotalVenta(id_venta);
    await pool.query('COMMIT');
    res.redirect(`/ventas/${id_venta}`);
  } catch (e) {
    await pool.query('ROLLBACK');
    res.status(500).send('Error creando la venta.');
  }
});

app.get('/ventas/:id', async (req, res) => {
  const { id } = req.params;
  const ventaQuery = await pool.query('SELECT * FROM ventas WHERE id_venta = $1', [id]);

  if (ventaQuery.rowCount === 0) {
    return res.status(404).send('Venta no encontrada.');
  }

  const detallesQuery = await pool.query(`
    SELECT d.*, p.nombre as producto_nombre
    FROM detalle_venta d
    JOIN productos p ON d.id_producto = p.id_producto
    WHERE d.id_venta = $1
    ORDER BY d.id_detalle
  `, [id]);

  const productosQuery = await pool.query('SELECT id_producto, nombre, precio_unitario FROM productos ORDER BY nombre');

  res.render('venta-detalle', {
    venta: ventaQuery.rows[0],
    detalles: detallesQuery.rows,
    productos: productosQuery.rows
  });
});

app.post('/ventas/:id/add-detalle', async (req, res) => {
  const { id } = req.params;
  const { id_producto, cantidad } = req.body;

  if (!id_producto || !cantidad || Number(cantidad) <= 0) {
    return res.status(400).send('Producto y cantidad válidos son obligatorios.');
  }

  try {
    await pool.query('BEGIN');

    const ventaExists = await pool.query('SELECT 1 FROM ventas WHERE id_venta = $1', [id]);
    if (ventaExists.rowCount === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).send('Venta no encontrada.');
    }

    const prod = await pool.query('SELECT precio_unitario FROM productos WHERE id_producto = $1', [id_producto]);
    if (prod.rowCount === 0) {
      await pool.query('ROLLBACK');
      return res.status(400).send('Producto no encontrado.');
    }

    const precio = prod.rows[0].precio_unitario;
    await pool.query(
      'INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio) VALUES ($1, $2, $3, $4)',
      [id, id_producto, cantidad, precio]
    );

    await actualizarTotalVenta(id);
    await pool.query('COMMIT');
    res.redirect(`/ventas/${id}`);
  } catch (e) {
    await pool.query('ROLLBACK');
    res.status(500).send('Error agregando el detalle.');
  }
});

app.post('/ventas/:id/update', async (req, res) => {
  const { id } = req.params;
  const { fecha } = req.body;
  await pool.query('UPDATE ventas SET fecha = $1 WHERE id_venta = $2', [fecha || new Date(), id]);
  res.redirect(`/ventas/${id}`);
});

app.post('/ventas/delete/:id', async (req, res) => {
  await pool.query('DELETE FROM ventas WHERE id_venta = $1', [req.params.id]);
  res.redirect('/ventas');
});

app.post('/detalle/:id/update', async (req, res) => {
  const { id } = req.params;
  const { cantidad } = req.body;

  if (!cantidad || Number(cantidad) <= 0) {
    return res.status(400).send('Cantidad válida es obligatoria.');
  }

  const detalleQuery = await pool.query('UPDATE detalle_venta SET cantidad = $1 WHERE id_detalle = $2 RETURNING id_venta', [cantidad, id]);
  if (detalleQuery.rowCount === 0) {
    return res.status(404).send('Detalle no encontrado.');
  }

  await actualizarTotalVenta(detalleQuery.rows[0].id_venta);
  res.redirect(`/ventas/${detalleQuery.rows[0].id_venta}`);
});

app.post('/detalle/:id/delete', async (req, res) => {
  const detalleQuery = await pool.query('DELETE FROM detalle_venta WHERE id_detalle = $1 RETURNING id_venta', [req.params.id]);
  if (detalleQuery.rowCount > 0) {
    await actualizarTotalVenta(detalleQuery.rows[0].id_venta);
    return res.redirect(`/ventas/${detalleQuery.rows[0].id_venta}`);
  }

  res.redirect('/ventas');
});

app.post('/categorias/create', async (req, res) => {
  const { nombre } = req.body;

  if (!nombre || nombre.trim() === '') {
    return res.status(400).send('El nombre de la categoría es requerido.');
  }

  await pool.query(
    'INSERT INTO categorias (nombre) VALUES ($1)',
    [nombre.trim()]
  );

  res.redirect('/productos');
});

app.listen(process.env.PORT || 3000, () => console.log('Servidor corriendo...'));
