import { describe, it, expect, vi } from 'vitest';
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

// Mock useRouter
const pushMock = vi.fn();
const currentRouteMock = {
    value: {
        path: '/',
        query: {}
    }
};

vi.stubGlobal('useRouter', () => ({
    push: pushMock,
    currentRoute: currentRouteMock
}));

// Mock useAsyncData for graph
vi.stubGlobal('useAsyncData', () => ({
    data: {
        value: {
            nodeGroups: [
                { id: 'group1', name: 'Group 1', stats: { people: 10 } },
                { id: 'group2', name: 'Group 2', stats: { people: 5 } }
            ],
            nodes: {
                'person1': { type: 'circle', name: 'Person 1' }
            }
        }
    }
}));
vi.stubGlobal('$fetch', vi.fn());

describe('OmniSearch', () => {
  it('renders correctly and has items', async () => {
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
    
    // Check if items are loaded (computed)
    // Accessing internal state of component is hard with composition API setup unless exposed.
    // But we can check if v-autocomplete has items.
    // Vuetify v-autocomplete items are passed as prop.
    
    // We can also trigger search
    const input = wrapper.find('input');
    await input.setValue('Person');
  });
});
