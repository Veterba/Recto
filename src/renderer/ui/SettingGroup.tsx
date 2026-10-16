/** A named group of settings: a label over a card of rows. */
export function SettingGroup({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="settings__group">
      <h3 className="settings__grouphead">{title}</h3>
      <div className="settings__card">{children}</div>
    </section>
  )
}
