const { listFriends } = require('../../services/friends');
const { errorMessage } = require('../../shared/api');

Component({
  properties: {
    selected: { type: Array, value: [] },
    max: { type: Number, value: 3 },
    disabled: { type: Boolean, value: false }
  },
  data: { items: [], cursor: null, loading: false, error: '', limitHint: '' },
  lifetimes: { attached() { this.load(); } },
  methods: {
    async load() {
      if (this.data.loading) return;
      const cursor = this.data.cursor;
      this.setData({ loading: true, error: '' });
      try {
        const data = await listFriends(cursor ? { cursor } : {});
        this.setData({ items: cursor ? this.data.items.concat(data.items) : data.items, cursor: data.next_cursor });
      } catch (error) {
        this.setData({ error: errorMessage(error) });
      } finally {
        this.setData({ loading: false });
      }
    },
    toggle(event) {
      if (this.data.disabled) return;
      const id = event.currentTarget.dataset.id;
      const selected = this.data.selected.slice();
      const index = selected.indexOf(id);
      if (index >= 0) selected.splice(index, 1);
      else if (selected.length < this.data.max) selected.push(id);
      else {
        this.setData({ limitHint: '最多可选择 ' + this.data.max + ' 位好友' });
        return;
      }
      this.setData({ limitHint: '' });
      this.triggerEvent('change', { ids: selected });
    }
  }
});
