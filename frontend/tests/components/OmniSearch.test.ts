import { describe, it, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import OmniSearch from '../../app/components/OmniSearch.vue';
import { defineComponent, h, Suspense } from 'vue';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

const vuetify = createVuetify({
  components,
  directives,
});

describe('OmniSearch', () => {
  it('renders correctly', async () => {
    const wrapper = mount(defineComponent({
        render() {
            return h(Suspense, null, {
                default: () => h(OmniSearch),
                fallback: () => h('div', 'fallback')
            });
        }
    }), {
        global: {
            plugins: [vuetify]
        }
    });
    
    await flushPromises();
    expect(wrapper.find('input').exists()).toBe(true);
  });
});
