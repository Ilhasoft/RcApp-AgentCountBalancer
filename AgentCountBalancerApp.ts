import {
    HttpStatusCode,
    IAppAccessors,
    IConfigurationExtend,
    IHttp,
    ILogger,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { ILivechatRoom, IPostLivechatRoomStarted } from '@rocket.chat/apps-engine/definition/livechat';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { SettingType } from '@rocket.chat/apps-engine/definition/settings';

export class AgentCountBalancerApp extends App implements IPostLivechatRoomStarted {
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);

    }

    public async executePostLivechatRoomStarted(room: ILivechatRoom, read: IRead, http: IHttp, persistence: IPersistence): Promise<void> {

        const authToken = await read.getEnvironmentReader().getSettings().getValueById('admin_token');
        const adminId = await read.getEnvironmentReader().getSettings().getValueById('admin_id');
        const baseUrl: string = await read.getEnvironmentReader().getServerSettings().getValueById('Site_Url');

        const reqOptions =  {
            headers: {
                'X-Auth-Token': authToken,
                'X-User-Id': adminId,
            },
            data: {},
        };

        let res = await http.get(baseUrl + '/api/v1/livechat/department', reqOptions);

        if (res.statusCode !== HttpStatusCode.OK || res.data.success !== true) {
            this.getLogger().error('Failed to get departments: ', res);
            return;
        }
        const departments = res.data.departments;

        await departments.map( async (department) => {
            const depId = department._id;
            res = await http.get(baseUrl + `/api/v1/livechat/department/${depId}`, reqOptions);
            if (res.statusCode !== HttpStatusCode.OK || res.data.success !== true) {
                this.getLogger().error('Failed to get department info: ', res);
                return;
            }
            const agents = res.data.agents;

            const size = agents ? agents.length : 0;
            const randomNumbers = Array.from({length: size}, () => Math.floor(Math.random() * size));

            agents.map( (agent, index) => {
                agent.count = randomNumbers[index];
            });
            const reqOptionsForPut = reqOptions;
            reqOptionsForPut.data = {department, agents};
            res = await http.put(baseUrl + `/api/v1/livechat/department/${depId}`, reqOptionsForPut);
            if (res.statusCode !== HttpStatusCode.OK || res.data.success !== true) {
                this.getLogger().error('Failed to update agents count value: ', res);
                return;
            }
        });

    }

    public async extendConfiguration(configuration: IConfigurationExtend): Promise<void> {

        await configuration.settings.provideSetting({
            id: 'admin_token',
            type: SettingType.STRING,
            packageValue: '',
            required: true,
            public: false,
            i18nLabel: 'Token de Autenticação',
        });

        await configuration.settings.provideSetting({
            id: 'admin_id',
            type: SettingType.STRING,
            packageValue: '',
            required: true,
            public: false,
            i18nLabel: 'ID de Usuário',
        });
    }

}
