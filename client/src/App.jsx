const layers = [
  { name: 'Frontend', detail: 'React + Vite', state: 'Ready' },
  { name: 'Database', detail: 'MongoDB + Mongoose', state: 'Configured' },
  { name: 'Data models', detail: '17 MongoDB collections', state: 'Ready' }
];

export default function App() {
  return (
    <main className="shell">
      <section className="panel" aria-labelledby="page-title">
        <p className="eyebrow">Hotel Booking System</p>
        <h1 id="page-title">Project foundation</h1>
        <p className="intro">
          The frontend scaffold and MongoDB model layer are ready for feature development.
        </p>

        <div className="status-list">
          {layers.map((layer) => (
            <article className="status-row" key={layer.name}>
              <div>
                <h2>{layer.name}</h2>
                <p>{layer.detail}</p>
              </div>
              <span>{layer.state}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
